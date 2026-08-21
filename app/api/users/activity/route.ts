import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const sp = new URL(req.url).searchParams;
    const page = Number(sp.get("page") || 1);
    const limit = Number(sp.get("limit") || 20);
    const skip = (page - 1) * limit;

    const [activities, total] = await Promise.all([
      prisma.activityLog.findMany({
        where: { userId: session.user.id },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          resource: true,
          resourceId: true,
          metadata: true,
          ipAddress: true,
          userAgent: true,
          createdAt: true,
        },
      }),
      prisma.activityLog.count({ where: { userId: session.user.id } }),
    ]);

    logger.info("[Route][Users][Activity] Fetched successfully", {
      userId: session.user.id,
      page,
      total,
    });

    return json({
      ok: true,
      data: {
        activities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (e) {
    logger.error("[Route][Users][Activity] Error:", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
