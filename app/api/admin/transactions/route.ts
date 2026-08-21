import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return error("Forbidden", 403);
    }

    const sp = new URL(req.url).searchParams;
    const page = parseInt(sp.get("page") || "1");
    const limit = parseInt(sp.get("limit") || "20");
    const skip = (page - 1) * limit;

    const type = sp.get("type") || undefined;
    const status = sp.get("status") || undefined;
    const search = sp.get("search") || undefined;
    const startDate = sp.get("startDate")
      ? new Date(sp.get("startDate")!)
      : undefined;
    const endDate = sp.get("endDate")
      ? new Date(sp.get("endDate")!)
      : undefined;

    const where: any = {};

    if (type) where.type = type;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { transactionNumber: { contains: search, mode: "insensitive" } },
        { referenceId: { contains: search, mode: "insensitive" } },
        { user: { email: { contains: search, mode: "insensitive" } } },
        { user: { userName: { contains: search, mode: "insensitive" } } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { id: true, email: true, userName: true } },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    // Calculate stats
    const [
      depositsResult,
      withdrawalsResult,
      orderPaymentsResult,
      refundsResult,
    ] = await Promise.all([
      prisma.transaction.aggregate({
        where: { type: "DEPOSIT", status: "COMPLETED" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "WITHDRAWAL", status: "COMPLETED" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "ORDER_PAYMENT", status: "COMPLETED" },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: "REFUND", status: "COMPLETED" },
        _sum: { amount: true },
      }),
    ]);

    return json({
      ok: true,
      data: {
        transactions,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        stats: {
          totalDeposits: Number(depositsResult._sum.amount || 0),
          totalWithdrawals: Number(withdrawalsResult._sum.amount || 0),
          totalOrderPayments: Number(orderPaymentsResult._sum.amount || 0),
          totalRefunds: Number(refundsResult._sum.amount || 0),
        },
      },
    });
  } catch (e) {
    logger.error("Admin transactions error:", e);
    if (e instanceof Error && e.message === "Unauthorized") {
      return error("Unauthorized", 401);
    }
    return error("Unexpected error", 500);
  }
}
