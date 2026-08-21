import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { ExchangeRateService } from "@/lib/server/services/exchange-rate.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Manual endpoint to refresh exchange rates
 * Can be called by cron job or admin dashboard
 * GET /api/exchange-rates/refresh
 */
export async function GET(req: NextRequest) {
  try {
    // Only admins can manually refresh rates
    const session = await requireAuth();

    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN") {
      return error("Unauthorized: Admin access required", 403);
    }

    logger.info(
      `[ExchangeRates] Manual refresh triggered by ${session.user.email}`
    );

    await ExchangeRateService.refreshCommonRates();

    return json({
      ok: true,
      message: "Exchange rates refreshed successfully",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("[ExchangeRates] Refresh failed:", err);
    return error("Failed to refresh exchange rates", 500);
  }
}

/**
 * Public endpoint to get current cached rates (no auth required)
 * GET /api/exchange-rates
 */
export async function POST(req: NextRequest) {
  try {
    const usdToRub = await ExchangeRateService.getUsdToRubRate();
    const usdToNgn = await ExchangeRateService.getUsdToNgnRate();

    return json({
      ok: true,
      data: {
        rates: {
          "USD/RUB": usdToRub,
          "USD/NGN": usdToNgn,
        },
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error("[ExchangeRates] Failed to get rates:", err);
    return error("Failed to get exchange rates", 500);
  }
}
