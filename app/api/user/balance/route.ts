import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { getRedisService } from "@/lib/server/services/redis.service";

export const runtime = "nodejs";

const redis = getRedisService();
const BALANCE_CACHE_TTL = 45; // seconds

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;

    // Try cache first
    const cached = await redis.getJSON<{ balance: number; currency: string }>(
      `user:balance:${userId}`
    );
    if (cached) {
      return json({ ok: true, data: cached });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true, currency: true },
    });

    if (!user) return error("User not found", 404);

    const data = {
      balance: Number(user.balance),
      currency: user.currency || "NGN",
    };

    // Cache for short time
    await redis.setJSON(`user:balance:${userId}`, data, BALANCE_CACHE_TTL);

    console.log("[Route][User][Balance] Fetched + cached", { userId });

    return json({ ok: true, data });
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
