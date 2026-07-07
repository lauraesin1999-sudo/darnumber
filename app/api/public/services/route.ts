import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { getRedisService } from "@/lib/server/services/redis.service";
import { buildAndCacheServices } from "../../orders/services/route";

export const runtime = "nodejs";

// Strong CDN caching for the public services catalog.
// This is the main lever for reducing Fast Origin Transfer.
// The data is identical for all users.
export const revalidate = 3600;

const redis = getRedisService();
const SERVICES_CACHE_KEY = "orders:services:aggregated:v2";

export async function GET(_req: NextRequest) {
  try {
    let cached = await redis.get(SERVICES_CACHE_KEY);

    if (!cached) {
      // Cold start: trigger build so the first public request warms the cache
      console.log("[public/services] Cache miss — triggering build");
      await buildAndCacheServices();
      cached = await redis.get(SERVICES_CACHE_KEY);
    }

    if (cached) {
      const parsed = JSON.parse(cached) as any;
      // Strip internal fields for client
      const { cachedAt, ...rest } = parsed;
      const clientData = {
        ...rest,
        services: parsed.services || [],
      };

      return json({ ok: true, data: clientData }, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    }

    // Extremely rare: still no data after build attempt
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
