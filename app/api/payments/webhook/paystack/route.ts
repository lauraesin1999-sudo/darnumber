import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { PaymentService } from "@/lib/server/services/payment.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const signature = req.headers.get("x-paystack-signature");
    logger.info(
      "[Route][Webhook][Paystack] Incoming",
      "signaturePresent=",
      !!signature,
      "rawLen=",
      (raw || "").length
    );
    const svc = new PaymentService();
    const result = await svc.handlePaystackWebhook(raw, signature);
    if (!result.ok) {
      logger.info(
        "[Route][Webhook][Paystack] Unauthorized",
        "status=",
        result.status || 401
      );
      return new Response("unauthorized", { status: result.status || 401 });
    }
    logger.info("[Route][Webhook][Paystack] Processed successfully");
    return json({ ok: true });
  } catch {
    logger.error("[Route][Webhook][Paystack] Invalid payload");
    return error("Invalid payload", 400);
  }
}
