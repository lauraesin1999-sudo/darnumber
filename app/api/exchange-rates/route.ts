import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { ExchangeRateService } from "@/lib/server/services/exchange-rate.service";

export const runtime = "nodejs";

// Enable CDN caching for this public, semi-static data.
// Revalidate every 5 minutes (adjust as your rates update frequency allows).
export const revalidate = 300;

/**
 * GET /api/exchange-rates
 * Public endpoint returning current cached exchange rates.
 * Used by the frontend to convert USD prices to NGN for display.
 */
export async function GET(_req: NextRequest) {
  console.log("[GET /api/exchange-rates] Fetching current rates...");
  try {
    const [usdToNgn, usdToRub] = await Promise.all([
      ExchangeRateService.getUsdToNgnRate(),
      ExchangeRateService.getUsdToRubRate(),
    ]);

    console.log(
      `[GET /api/exchange-rates] Rates: USD/NGN=${usdToNgn}, USD/RUB=${usdToRub}`,
    );

    const data = {
      usdToNgn,
      usdToRub,
      rubToUsd: 1 / usdToRub,
      source: "moneyconvert.net",
      timestamp: new Date().toISOString(),
    };

    return json(
      { ok: true, data },
      {
        headers: {
          "Cache-Control": "s-maxage=300, stale-while-revalidate=3600",
        },
      }
    );
  } catch (e) {
    console.error("[GET /api/exchange-rates] Error:", e);
    // Return fallback rates rather than failing
    return json({
      ok: true,
      data: {
        usdToNgn: 1600,
        usdToRub: 100,
        rubToUsd: 0.01,
        timestamp: new Date().toISOString(),
        fallback: true,
      },
    });
  }
}
