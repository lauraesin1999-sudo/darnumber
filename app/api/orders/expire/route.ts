import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { prisma } from "@/lib/server/prisma";
import { OrderService } from "@/lib/server/services/order.service";
import { requireAuth } from "@/lib/server/auth";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// Sweeps and expires overdue orders; intended to be called periodically
// Requires admin role
export async function POST(_req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return error("Forbidden: Admin access required", 403);
    }
    const now = new Date();
    const overdue = await prisma.order.findMany({
      where: {
        expiresAt: { lt: now },
        status: { in: ["PENDING", "PROCESSING", "WAITING_FOR_SMS"] },
      },
      select: { id: true },
      take: 1000,
    });

    const service = new OrderService();
    let success = 0;
    for (const o of overdue) {
      try {
        // getOrderStatus contains auto-expire/refund logic
        await service.getOrderStatus(o.id);
        success++;
      } catch (e) {
        logger.error("[ExpireSweep] failed for", o.id, e);
      }
    }
    return json({
      ok: true,
      data: { checked: overdue.length, expired: success },
    });
  } catch (e) {
    logger.error("[ExpireSweep] error", e);
    return error("Unexpected error", 500);
  }
}
