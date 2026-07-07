import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { getRedisService } from "@/lib/server/services/redis.service";

export const runtime = "nodejs";

const redis = getRedisService();
const STATS_CACHE_TTL = 120; // 2 minutes - stats are expensive but can be slightly stale

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    // Get query parameters for date filtering
    const sp = new URL(req.url).searchParams;
    const days = Number(sp.get("days") || 30);

    // Check Redis cache first (key includes days for different filters)
    const cacheKey = `user:stats:${userId}:${days}`;
    const cached = await redis.getJSON<any>(cacheKey);
    if (cached) {
      return json({ ok: true, data: cached });
    }

    console.log("[Route][User][Stats] Starting fetch for userId:", userId);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Fetch user data
    console.log("[Route][User][Stats] Fetching user data...");
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
    console.log("[Route][User][Stats] User data fetched successfully");

    // Fetch order statistics
    console.log("[Route][User][Stats] Fetching order statistics...");
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
    console.log("[Route][User][Stats] Order statistics fetched successfully");

    // Fetch transaction statistics
    console.log("[Route][User][Stats] Fetching transaction statistics...");
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
    console.log(
      "[Route][User][Stats] Transaction statistics fetched successfully"
    );

    // Fetch referral statistics
    console.log("[Route][User][Stats] Fetching referral statistics...");
    const [referralCount, referralRewards] = await Promise.all([
      prisma.referral.count({ where: { referrerId: userId } }),
      prisma.referral.aggregate({
        where: { referrerId: userId, rewardPaid: true },
        _sum: {
          referrerReward: true,
        },
      }),
    ]);
    console.log(
      "[Route][User][Stats] Referral statistics fetched successfully"
    );

    // Recent activity within the time period
    console.log("[Route][User][Stats] Fetching recent activity...");
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
    console.log("[Route][User][Stats] Recent activity fetched successfully");

    // Calculate success rate
    console.log("[Route][User][Stats] Building response...");
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
        recent: recentOrders,
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

    console.log("[Route][User][Stats] Fetched successfully", {
      userId,
      totalOrders,
      totalTransactions,
    });

    // Cache result
    await redis.setJSON(cacheKey, stats, STATS_CACHE_TTL);

    return json({
      ok: true,
      data: stats,
    });
  } catch (e) {
    console.error("[Route][User][Stats] Error:", e);
    console.error("[Route][User][Stats] Error details:", {
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      name: e instanceof Error ? e.name : undefined,
    });
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error(e instanceof Error ? e.message : "Unexpected error", 500);
  }
}
