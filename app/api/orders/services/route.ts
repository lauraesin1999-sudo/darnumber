import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import {
  getServicesCatalog,
  buildAndCacheServices,
} from "@/lib/server/services/services-catalog.service";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Re-export for any leftover imports that expected the old module path
export { buildAndCacheServices };

/**
 * GET /api/orders/services
 *
 * Returns the lightweight services catalog (unique services + providers +
 * exchange rate). Country/price rows are available via
 * /api/public/services/countries — do not expand the full matrix here.
 */
export async function GET() {
  logger.info("\n╔════════════════════════════════════════════════╗");
  logger.info("║   GET /api/orders/services - Lightweight catalog");
  logger.info("╚════════════════════════════════════════════════╝");
  try {
    try {
      const authResult = await requireAuth();
      logger.info(
        `[Auth] ✓ User ${authResult?.user?.email} authenticated (optional)`,
      );
    } catch {
      logger.info("[Auth] Serving public catalog (no auth)");
    }

    const catalog = await getServicesCatalog();

    if (catalog) {
      logger.info(
        `[Catalog] ✓ Serving ${catalog.services.length} unique services`,
      );
      logger.info("╚════════════════════════════════════════════════╝\n");
      return json(
        { ok: true, data: catalog },
        {
          headers: {
            "Cache-Control":
              "public, s-maxage=3600, stale-while-revalidate=86400",
          },
        },
      );
    }

    logger.info("╚════════════════════════════════════════════════╝\n");
    return error(
      "No services available from providers. Please check API keys and try again.",
      503,
    );
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized") {
      return error("Unauthorized", 401);
    }
    logger.error(
      "[Error] ✗ Request failed:",
      e instanceof Error ? e.message : e,
    );
    logger.info("╚════════════════════════════════════════════════╝\n");
    return error(
      `Service aggregation failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      500,
    );
  }
}
