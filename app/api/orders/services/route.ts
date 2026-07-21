import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import {
  getServicesCatalog,
  buildAndCacheServices,
} from "@/lib/server/services/services-catalog.service";

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
  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   GET /api/orders/services - Lightweight catalog");
  console.log("╚════════════════════════════════════════════════╝");
  try {
    try {
      const authResult = await requireAuth();
      console.log(
        `[Auth] ✓ User ${authResult?.user?.email} authenticated (optional)`,
      );
    } catch {
      console.log("[Auth] Serving public catalog (no auth)");
    }

    const catalog = await getServicesCatalog();

    if (catalog) {
      console.log(
        `[Catalog] ✓ Serving ${catalog.services.length} unique services`,
      );
      console.log("╚════════════════════════════════════════════════╝\n");
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

    console.log("╚════════════════════════════════════════════════╝\n");
    return error(
      "No services available from providers. Please check API keys and try again.",
      503,
    );
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized") {
      return error("Unauthorized", 401);
    }
    console.error(
      "[Error] ✗ Request failed:",
      e instanceof Error ? e.message : e,
    );
    console.log("╚════════════════════════════════════════════════╝\n");
    return error(
      `Service aggregation failed: ${e instanceof Error ? e.message : "Unknown error"}`,
      500,
    );
  }
}
