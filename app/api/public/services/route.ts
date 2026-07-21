import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { buildAndCacheServices } from "../../orders/services/route";

export const runtime = "nodejs";

// Strong CDN caching for the public services catalog.
// This is the main lever for reducing Fast Origin Transfer.
// The data is identical for all users.
export const revalidate = 3600;

// Re-export the in-memory cache reference from the orders/services module
// so this route shares the same cache and doesn't trigger a duplicate build.
// buildAndCacheServices populates `memoryCache` in that module; we read it back
// via the return value.
export async function GET(_req: NextRequest) {
  try {
    // Build if not already cached in memory (shared module-level state)
    console.log("[public/services] Cache miss — triggering build");
    const built = await buildAndCacheServices();

    if (built) {
      // Strip internal cachedAt timestamp before sending to clients
      const { cachedAt, ...clientData } = built as any;
      return json({ ok: true, data: clientData }, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    }

    // Extremely rare: all providers returned empty
    return json(
      { ok: true, data: { services: [], providers: [], exchangeRate: null } },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (e) {
    console.error("[public/services] error", e);
    return error("Failed to load public services catalog", 500);
  }
}
