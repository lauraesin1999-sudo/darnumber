import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { buildAndCacheServices } from "../../orders/services/route";

export const runtime = "nodejs";
// `dynamic = "force-dynamic"` prevents Vercel from pre-rendering this route as an
// ISR page. The response is ~54MB of JSON — well above Vercel's 19MB ISR limit.
// CDN caching is handled entirely by the Cache-Control header below.
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const built = await buildAndCacheServices();

    if (built) {
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
