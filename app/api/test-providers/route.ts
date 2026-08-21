import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { SMSManService } from "@/lib/server/services/order.service";
import { TextVerifiedService } from "@/lib/server/services/textverified.service";
import { logger } from "@/lib/logger";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  logger.info("=== GET /api/test-providers START ===");
  try {
    logger.info("Testing SMS providers without authentication...");

    // Test SMS-Man
    let smsManServices: any[] = [];
    let smsManError: string | null = null;
    try {
      logger.info("Testing SMS-Man API...");
      const smsManService = new SMSManService();
      smsManServices = await smsManService.getAvailableServices();
      logger.info("SMS-Man services count:", smsManServices.length);
      logger.info("Sample SMS-Man service:", smsManServices[0]);
    } catch (err) {
      smsManError = err instanceof Error ? err.message : "Unknown error";
      logger.error("SMS-Man error:", smsManError);
    }

    // Test TextVerified
    let tvServices: any[] = [];
    let tvError: string | null = null;
    try {
      logger.info("Testing Panda API...");
      const textVerifiedService = new TextVerifiedService();
      tvServices = await textVerifiedService.getAvailableServices();
      logger.info("Panda services count:", tvServices.length);
      logger.info("Sample Panda service:", tvServices[0]);
    } catch (err) {
      tvError = err instanceof Error ? err.message : "Unknown error";
      logger.error("Panda error:", tvError);
    }

    const result = {
      smsMan: {
        success: smsManError === null,
        error: smsManError,
        servicesCount: smsManServices.length,
        sampleService: smsManServices[0] || null,
      },
      textVerified: {
        success: tvError === null,
        error: tvError,
        servicesCount: tvServices.length,
        sampleService: tvServices[0] || null,
      },
      totalServices: smsManServices.length + tvServices.length,
    };

    logger.info("Test result:", result);
    logger.info("=== GET /api/test-providers END ===");

    return json({ ok: true, data: result });
  } catch (e) {
    logger.error("=== GET /api/test-providers ERROR ===");
    logger.error("Error:", e);
    return error("Test failed", 500);
  }
}
