import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { OrderService } from "@/lib/server/services/order.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  logger.info("=== GET /api/orders/services/available START ===");
  try {
    logger.info("1. Starting authentication check...");
    const authResult = await requireAuth();
    logger.info("2. Authentication successful:", {
      userId: authResult?.user?.id,
      email: authResult?.user?.email,
    });

    logger.info("3. Parsing request URL:", req.url);
    const { searchParams } = new URL(req.url);

    const serviceCode = searchParams.get("serviceCode") || "";
    const country = searchParams.get("country") || "";

    logger.info("4. Extracted parameters:", {
      serviceCode,
      country,
      hasServiceCode: !!serviceCode,
      hasCountry: !!country,
      allParams: Object.fromEntries(searchParams.entries()),
    });

    if (!serviceCode || !country) {
      logger.info("5. ❌ VALIDATION FAILED - Missing required parameters");
      return error("serviceCode and country required", 400);
    }

    logger.info("5. ✅ Validation passed, creating OrderService...");
    const service = new OrderService();

    logger.info("6. Fetching available providers...");
    const providers = await service.getAvailableProviders(serviceCode, country);

    logger.info("7. ✅ Successfully retrieved providers:", {
      count: providers?.length || 0,
      providers: providers,
    });

    logger.info("=== GET /api/orders/services/available END (SUCCESS) ===");
    return json({ ok: true, data: providers });
  } catch (e) {
    logger.error("=== GET /api/orders/services/available ERROR ===");
    logger.error("Error details:", {
      message: e instanceof Error ? e.message : "Unknown error",
      stack: e instanceof Error ? e.stack : undefined,
      error: e,
    });

    if (e instanceof Error && e.message === "Unauthorized") {
      logger.info("Returning 401 Unauthorized");
      return error("Unauthorized", 401);
    }

    logger.info("Returning 500 Unexpected error");
    return error("Unexpected error", 500);
  }
}
