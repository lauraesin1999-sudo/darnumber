import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { PaymentService } from "@/lib/server/services/payment.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    logger.info(
      "[Route][Webhook][Etegram] Incoming",
      "keys=",
      Object.keys(payload || {})
    );
    const svc = new PaymentService();
    const result = await svc.handleEtegramWebhook(payload);
    if (!result.ok) {
      logger.info("[Route][Webhook][Etegram] Unsuccessful event");
      return error("Invalid or unsuccessful event", 400);
    }
    logger.info("[Route][Webhook][Etegram] Processed successfully");
    return json({ ok: true });
  } catch {
    logger.error("[Route][Webhook][Etegram] Invalid payload");
    return error("Invalid payload", 400);
  }
}
