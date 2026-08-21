import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { OrderService } from "@/lib/server/services/order.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  logger.info("[GET /api/orders/[orderId]] Request received");

  try {
    logger.info("[GET /api/orders/[orderId]] Authenticating user...");
    await requireAuth();
    logger.info("[GET /api/orders/[orderId]] Authentication successful");

    const service = new OrderService();
    const { orderId } = await params;
    logger.info(
      `[GET /api/orders/[orderId]] Fetching order status for orderId: ${orderId}`
    );

    const data = await service.getOrderStatus(orderId);

    if (!data) {
      logger.info(`[GET /api/orders/[orderId]] Order not found: ${orderId}`);
      return error("Not found", 404);
    }

    logger.info(`[GET /api/orders/[orderId]] Order found:`, {
      orderId: data.id,
      status: data.status,
      type: data.type,
    });

    return json({ ok: true, data });
  } catch (e) {
    logger.error("[GET /api/orders/[orderId]] Error occurred:", e);

    if (e instanceof Error && e.message === "Unauthorized") {
      logger.info("[GET /api/orders/[orderId]] Unauthorized access attempt");
      return error("Unauthorized", 401);
    }

    logger.error("[GET /api/orders/[orderId]] Unexpected error:", e);
    return error("Unexpected error", 500);
  }
}
