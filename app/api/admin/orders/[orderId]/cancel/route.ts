import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { prisma } from "@/lib/server/prisma";
import { OrderService } from "@/lib/server/services/order.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  try {
    const session = await requireAuth();
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return error("Forbidden", 403);
    }

    const { orderId } = await params;
    const service = new OrderService();
    const result = await service.cancelOrder(orderId, session.user.id, {
      asAdmin: true,
      reason: "ADMIN_CANCELLED",
    });

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    await prisma.activityLog.create({
      data: {
        userId: order?.userId || session.user.id,
        action: "ORDER_CANCELLED_BY_ADMIN",
        resource: "order",
        resourceId: orderId,
        metadata: {
          adminId: session.user.id,
        },
      },
    });

    return json({ ok: true, data: result });
  } catch (e) {
    logger.error("Admin cancel order error", e);
    const msg = e instanceof Error ? e.message : "Unexpected error";
    if (msg === "Unauthorized") return error("Unauthorized", 401);
    if (msg.includes("not found")) return error(msg, 404);
    return error(msg, 400);
  }
}
