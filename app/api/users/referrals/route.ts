import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();

    // Get user's referral code and referrals
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        referralCode: true,
        referredBy: true,
      },
    });

    if (!user) return error("User not found", 404);

    // Get all users referred by this user
    const referrals = await prisma.referral.findMany({
      where: { referrerId: session.user.id },
      include: {
        referred: {
          select: {
            id: true,
            userName: true,
            email: true,
            createdAt: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Calculate total rewards
    const rewardStats = await prisma.referral.aggregate({
      where: { referrerId: session.user.id },
      _sum: {
        referrerReward: true,
      },
      _count: true,
    });

    // Get paid rewards count
    const paidRewardsCount = await prisma.referral.count({
      where: {
        referrerId: session.user.id,
        rewardPaid: true,
      },
    });

    logger.info("[Route][Users][Referrals] Fetched successfully", {
      userId: session.user.id,
      totalReferrals: referrals.length,
    });

    return json({
      ok: true,
      data: {
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        referrals: referrals.map((r) => ({
          id: r.id,
          user: r.referred,
          referrerReward: Number(r.referrerReward || 0),
          referredReward: Number(r.referredReward || 0),
          rewardPaid: r.rewardPaid,
          createdAt: r.createdAt,
        })),
        stats: {
          totalReferrals: rewardStats._count,
          totalRewards: Number(rewardStats._sum.referrerReward || 0),
          paidRewards: paidRewardsCount,
          pendingRewards: rewardStats._count - paidRewardsCount,
        },
      },
    });
  } catch (e) {
    logger.error("[Route][Users][Referrals] Error:", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
