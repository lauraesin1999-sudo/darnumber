import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    // Get query parameters for date filtering
    const sp = new URL(req.url).searchParams;
    const days = Number(sp.get("days") || 30);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch user data
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        balance: true,
        currency: true,
        createdAt: true,
        referralCode: true,
      },
    });

    if (!user) return error("User not found", 404);

    // Fetch order statistics
    const [ordersByStatus, totalOrders, recentOrders] = await Promise.all([
      prisma.order.groupBy({
        by: ["status"],
        where: { userId },
        _count: true,
      }),
      prisma.order.count({ where: { userId } }),
      prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          orderNumber: true,
          serviceCode: true,
          country: true,
          status: true,
          finalPrice: true,
          currency: true,
          createdAt: true,
        },
      }),
    ]);

    // Fetch transaction statistics
    const [transactionsByType, totalTransactions, totalSpent, totalDeposits] =
      await Promise.all([
        prisma.transaction.groupBy({
          by: ["type"],
          where: {
            userId,
            status: "COMPLETED",
          },
          _count: true,
          _sum: {
            amount: true,
          },
        }),
        prisma.transaction.count({ where: { userId } }),
        prisma.transaction.aggregate({
          where: {
            userId,
            type: "ORDER_PAYMENT",
            status: "COMPLETED",
          },
          _sum: {
            amount: true,
          },
        }),
        prisma.transaction.aggregate({
          where: {
            userId,
            type: "DEPOSIT",
            status: "COMPLETED",
          },
          _sum: {
            amount: true,
          },
        }),
      ]);

    // Fetch referral statistics
    const [referralCount, referralRewards] = await Promise.all([
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.referral.aggregate({
        where: { referrerId: userId, rewardPaid: true },
        _sum: {
          referrerReward: true,
        },
      }),
    ]);

    // Recent activity within the time period
    const [recentOrdersCount, recentTransactionsCount] = await Promise.all([
      prisma.order.count({
        where: {
          userId,
          createdAt: { gte: startDate },
        },
      }),
      prisma.transaction.count({
        where: {
          userId,
          createdAt: { gte: startDate },
        },
      }),
    ]);

    // Calculate success rate
    const completedOrders =
      ordersByStatus.find((s) => s.status === "COMPLETED")?._count || 0;
    const successRate =
      totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(2) : 0;

    // Build response
    const stats = {
      balance: {
        current: Number(user.balance),
        currency: user.currency,
      },
      orders: {
        total: totalOrders,
        byStatus: ordersByStatus.reduce((acc, item) => {
          acc[item.status] = item._count;
          return acc;
        }, {} as Record<string, number>),
        completed: completedOrders,
        successRate: Number(successRate),
        recent: recentOrders.map((o) => ({
          ...o,
          finalPrice: Number(o.finalPrice),
        })),
        recentCount: recentOrdersCount,
      },
      transactions: {
        total: totalTransactions,
        byType: transactionsByType.reduce(
          (acc, item) => {
            acc[item.type] = {
              count: item._count,
              total: Number(item._sum.amount || 0),
            };
            return acc;
          },
          {} as Record<
            string,
            {
              count: number;
              total: number;
            }
          >
        ),
        totalSpent: Number(totalSpent._sum.amount || 0),
        totalDeposits: Number(totalDeposits._sum.amount || 0),
        recentCount: recentTransactionsCount,
      },
      referrals: {
        totalReferred: referralCount,
        totalRewards: Number(referralRewards._sum.referrerReward || 0),
        referralCode: user.referralCode,
      },
      account: {
        memberSince: user.createdAt,
        daysActive: Math.floor(
          (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        ),
      },
      period: {
        days,
        startDate,
      },
    };

    logger.info("[Route][Users][Stats] Fetched successfully", {
      userId,
      totalOrders,
      totalTransactions,
    });

    return json({
      ok: true,
      data: stats,
    });
  } catch (e) {
    logger.error("[Route][Users][Stats] Error:", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
