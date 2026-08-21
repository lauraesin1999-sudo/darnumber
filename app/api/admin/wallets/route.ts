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

    const search = sp.get("search") || undefined;
    const sortBy = sp.get("sortBy") || "balance-desc";

    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: "insensitive" } },
        { userName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ];
    }

    // Determine sort order
    let orderBy: any = { balance: "desc" };
    switch (sortBy) {
      case "balance-asc":
        orderBy = { balance: "asc" };
        break;
      case "balance-desc":
        orderBy = { balance: "desc" };
        break;
      case "name-asc":
        orderBy = { userName: "asc" };
        break;
      case "name-desc":
        orderBy = { userName: "desc" };
        break;
      case "recent":
        orderBy = { lastLoginAt: "desc" };
        break;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: {
          id: true,
          email: true,
          userName: true,
          phone: true,
          balance: true,
          currency: true,
          status: true,
          role: true,
          country: true,
          lastLoginAt: true,
          createdAt: true,
          _count: { select: { orders: true, transactions: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Calculate stats
    const [balanceStats, activeWallets] = await Promise.all([
      prisma.user.aggregate({
        _sum: { balance: true },
        _avg: { balance: true },
        _max: { balance: true },
      }),
      prisma.user.count({
        where: { balance: { gt: 0 } },
      }),
    ]);

    return json({
      ok: true,
      data: {
        users,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        stats: {
          totalBalance: Number(balanceStats._sum.balance || 0),
          avgBalance: Number(balanceStats._avg.balance || 0),
          maxBalance: Number(balanceStats._max.balance || 0),
          activeWallets,
        },
      },
    });
  } catch (e) {
    logger.error("Admin wallets error:", e);
    if (e instanceof Error && e.message === "Unauthorized") {
      return error("Unauthorized", 401);
    }
    return error("Unexpected error", 500);
  }
}
