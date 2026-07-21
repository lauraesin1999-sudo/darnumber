import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { getServicesCatalog } from "@/lib/server/services/services-catalog.service";

export const runtime = "nodejs";
// Catalog is a small unique-service index (tens of KB), not the old ~54MB matrix.
// force-dynamic still applies so we control Cache-Control headers ourselves.
export const dynamic = "force-dynamic";

/**
 * GET /api/public/services
 *
 * Lightweight catalog: unique services (code + name + providers), provider
 * list, and exchange rate. Country/price rows are loaded on demand via
 * GET /api/public/services/countries?serviceCode=&provider=
 */
export async function GET(_req: NextRequest) {
  try {
    const catalog = await getServicesCatalog();

    if (catalog) {
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

    return json(
      {
        ok: true,
        data: { services: [], providers: [], exchangeRate: null },
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (e) {
    console.error("[public/services] error", e);
    return error("Failed to load public services catalog", 500);
  }
}
