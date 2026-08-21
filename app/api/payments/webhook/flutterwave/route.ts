import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { PaymentService } from "@/lib/server/services/payment.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    const signature = req.headers.get("verif-hash");
    logger.info(
      "[Route][Webhook][Flutterwave] Incoming",
      "signaturePresent=",
      !!signature,
      "rawLen=",
      (raw || "").length
    );
    const svc = new PaymentService();
    const result = await svc.handleFlutterwaveWebhook(raw, signature);
    if (!result.ok) {
      logger.info(
        "[Route][Webhook][Flutterwave] Unauthorized",
        "status=",
        result.status || 401
      );
      return new Response("unauthorized", { status: result.status || 401 });
    }
    logger.info("[Route][Webhook][Flutterwave] Processed successfully");
    return json({ ok: true });
  } catch {
    logger.error("[Route][Webhook][Flutterwave] Invalid payload");
    return error("Invalid payload", 400);
  }
}
