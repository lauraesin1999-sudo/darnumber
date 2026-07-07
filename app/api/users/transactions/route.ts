import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { getRedisService } from "@/lib/server/services/redis.service";

export const runtime = "nodejs";

const redis = getRedisService();
const TX_CACHE_TTL = 60;

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const sp = new URL(req.url).searchParams;
    const page = Number(sp.get("page") || 1);
    const limit = Number(sp.get("limit") || 20);

    const search = sp.get("search") || "";
    const type = sp.get("type") || "";
    const status = sp.get("status") || "";

    const filterKey = `${type}:${status}:${search}`;

    const cached = await redis.getUserTransactions(userId, page, limit, filterKey);
    if (cached) {
      return json({ ok: true, data: cached });
    }

    const skip = (page - 1) * limit;

    // Build where clause with filters
    const where: any = { userId };

    if (search) {
      where.OR = [
        { transactionNumber: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          transactionNumber: true,
          type: true,
          amount: true,
          currency: true,
          balanceBefore: true,
          balanceAfter: true,
          orderId: true,
          referenceId: true,
          paymentMethod: true,
          status: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    console.log("[Route][Users][Transactions] Fetched successfully", {
      userId,
      page,
      total,
    });

    const result = {
      transactions: transactions.map((t) => ({
        ...t,
        amount: Number(t.amount),
        balanceBefore: Number(t.balanceBefore),
        balanceAfter: Number(t.balanceAfter),
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };

    await redis.setUserTransactions(userId, page, limit, filterKey, result, TX_CACHE_TTL);

    return json({ ok: true, data: result });
  } catch (e) {
    console.error("[Route][Users][Transactions] Error:", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
