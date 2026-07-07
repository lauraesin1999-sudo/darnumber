import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { PROVIDERS } from "@/lib/constants/providers";
import { SMSManService } from "@/lib/server/services/order.service";
import { TextVerifiedService } from "@/lib/server/services/textverified.service";
import { ExchangeRateService } from "@/lib/server/services/exchange-rate.service";
import { PricingService } from "@/lib/server/services/pricing.service";
import { getRedisService } from "@/lib/server/services/redis.service";

export const runtime = "nodejs";

const redis = getRedisService();
const SERVICES_CACHE_KEY = "orders:services:aggregated:v2";
const SERVICES_CACHE_TTL_SECONDS = 90 * 60; // 90 min — amortises the expensive external fetches + processing (tune based on price volatility)
const PROVIDER_FETCH_TIMEOUT_MS = 25000;

// TextVerified baseline USD used during the aggregated build.
// Exact service-level TV pricing is fetched lazily on service selection.
const TV_DEFAULT_BASE_PRICE_USD = 2.5;

// In-memory cache fallback for when Redis is OOM
// `cachedAt` is stored so the stale-while-revalidate logic can check age.
const SERVICES_STALE_AFTER_SECONDS = 24 * 60; // serve stale, refresh in background after 24 min
let memoryCache: { data: string; expiresAt: number; cachedAt: number } | null =
  null;
let refreshInProgress = false;
type AggregatedServicesPayload = {
  services: unknown[];
  providers: Array<{
    id: string;
    name: string;
    displayName: string;
    logo?: string;
    cover: string;
  }>;
  exchangeRate: {
    usdToNgn: number;
    usdToRub: number;
    source: string;
    timestamp: string;
  };
};
let refreshPromise: Promise<AggregatedServicesPayload | null> | null = null;

async function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = PROVIDER_FETCH_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Fetches all provider services, applies admin pricing rules, and writes the
 * result to Redis + in-memory cache. Guarded by `refreshInProgress` so
 * concurrent stale-while-revalidate background triggers are coalesced into one.
 */
async function buildAndCacheServices(): Promise<AggregatedServicesPayload | null> {
  if (refreshInProgress && refreshPromise) {
    return refreshPromise;
  }

  refreshInProgress = true;
  refreshPromise = (async () => {
    try {
      console.log("[Build] Starting services cache build...");
      const rubToUsdRate = await ExchangeRateService.getUsdToRubRate();
      const usdToNgnRate = await ExchangeRateService.getUsdToNgnRate();
      console.log(
        `[Build] Rates: 1 USD = ${rubToUsdRate} RUB, 1 USD = ${usdToNgnRate} NGN`,
      );

      const providers = [
        {
          id: PROVIDERS.LION.id,
          name: "sms-man",
          displayName: PROVIDERS.LION.displayName,
          logo: PROVIDERS.LION.logo,
          cover: "All Countries",
        },
        {
          id: PROVIDERS.PANDA.id,
          name: "textverified",
          displayName: PROVIDERS.PANDA.displayName,
          logo: PROVIDERS.PANDA.logo,
          cover: "United States",
        },
      ];

      const servicesMap = new Map<string, any>();

      console.log("[Build] Fetching provider services in parallel (with Redis sub-caching)...");
      const [smsManResult, tvResult] = await Promise.allSettled([
        withTimeout(
          (async () => {
            // Check sub-cache first to avoid expensive external calls on every rebuild
            const cached = await redis.getProviderServices("sms-man");
            if (cached && Array.isArray(cached) && cached.length > 0) {
              console.log(`[SMSMan] ✓ Using Redis sub-cache (${cached.length} services)`);
              return cached;
            }
            console.log("[SMSMan] Fetching services from provider...");
            const smsManService = new SMSManService();
            const services = await smsManService.getAvailableServices();
            console.log(
              `[SMSMan] ✓ Fetched ${services.length} services (RUB pricing)`,
            );
            // Cache raw for 2h to amortize slow provider calls
            await redis.setProviderServices("sms-man", services, 7200);
            return services;
          })(),
          "SMS-Man service fetch",
          60 * 1000,
        ),
        withTimeout(
          (async () => {
            const cached = await redis.getProviderServices("textverified");
            if (cached && Array.isArray(cached) && cached.length > 0) {
              console.log(`[TextVerified] ✓ Using Redis sub-cache (${cached.length} services)`);
              return cached;
            }
            console.log("[TextVerified] Fetching service list from provider...");
            const textVerifiedService = new TextVerifiedService();
            const basicServices =
              await textVerifiedService.getAvailableServices();
            const services = basicServices.map((service) => ({
              ...service,
              price: TV_DEFAULT_BASE_PRICE_USD,
            }));
            console.log(
              `[TextVerified] ✓ Fetched ${services.length} services (baseline pricing)`,
            );
            await redis.setProviderServices("textverified", services, 7200);
            return services;
          })(),
          "TextVerified service fetch",
          25 * 1000,
        ),
      ]);

      const smsManServices =
        smsManResult.status === "fulfilled" ? smsManResult.value : [];
      if (smsManResult.status === "rejected") {
        console.error(
          "[SMSMan] ✗ Error:",
          smsManResult.reason instanceof Error
            ? smsManResult.reason.message
            : smsManResult.reason,
        );
      }

      const tvServices = tvResult.status === "fulfilled" ? tvResult.value : [];
      if (tvResult.status === "rejected") {
        console.error(
          "[TextVerified] ✗ Error:",
          tvResult.reason instanceof Error
            ? tvResult.reason.message
            : tvResult.reason,
        );
      }

      if (smsManServices.length === 0 && tvServices.length === 0) {
        console.error(
          "[Build] No services from any provider — skipping cache write",
        );
        return null;
      }

      console.log(
        `[Build] Total raw: SMS-Man ${smsManServices.length} + TextVerified ${tvServices.length}`,
      );

      const servicesToPrice: Array<{
        basePrice: number;
        serviceCode: string;
        country: string;
      }> = [];
      const serviceMetadata: Array<{
        key: string;
        providerData: any;
        providerId: string;
        providerName: string;
      }> = [];

      smsManServices.forEach((service: any, idx: number) => {
        const baseUSD = Number((service.price / rubToUsdRate).toFixed(4));
        if (idx === 0) {
          console.log(
            `[SMSMan] Sample base: ${service.price} RUB → $${baseUSD} USD`,
          );
        }
        servicesToPrice.push({
          basePrice: baseUSD,
          serviceCode: service.code,
          country: service.country,
        });
        serviceMetadata.push({
          key: `${service.code}-${service.country}`,
          providerData: service,
          providerId: PROVIDERS.LION.id,
          providerName: "sms-man",
        });
      });

      tvServices.forEach((service: any, idx: number) => {
        const baseUSD = service.price || 0;
        if (idx === 0) {
          console.log(`[TextVerified] Sample base: $${baseUSD} USD`);
        }
        servicesToPrice.push({
          basePrice: baseUSD,
          serviceCode: service.serviceName || service.code,
          country: "US",
        });
        serviceMetadata.push({
          key: `${service.serviceName || service.code}-US`,
          providerData: {
            ...service,
            code: service.serviceName || service.code,
            country: "US",
            name: service.serviceName || service.name,
          },
          providerId: PROVIDERS.PANDA.id,
          providerName: "textverified",
        });
      });

      console.log("[Build] Applying admin pricing rules...");
      const pricingResults =
        await PricingService.calculatePrices(servicesToPrice);

      if (pricingResults.length > 0) {
        const first = pricingResults[0];
        console.log(
          `[Build] Sample pricing: $${first.basePrice.toFixed(4)} base + $${first.profit.toFixed(4)} profit = $${first.finalPrice.toFixed(4)}`,
          first.ruleApplied
            ? `(Rule: ${first.ruleApplied.profitType} ${first.ruleApplied.profitValue})`
            : "(Default 20%)",
        );
      }

      pricingResults.forEach((priceResult, idx) => {
        const metadata = serviceMetadata[idx];
        const service = metadata.providerData;
        const priceUSD = Number(priceResult.finalPrice.toFixed(2));

        if (!servicesMap.has(metadata.key)) {
          servicesMap.set(metadata.key, {
            code: service.code,
            name: service.name,
            country: service.country,
            price: priceUSD,
            prices: { [metadata.providerId]: priceUSD },
            currency: "USD",
            providerId: metadata.providerName,
            capability: service.capability || "sms",
            ui: {
              logo: "📱",
              color: "bg-gray-200",
              displayName: service.name,
            },
            providers: [
              {
                id: metadata.providerId,
                name: metadata.providerName,
                displayName:
                  metadata.providerName === "sms-man"
                    ? PROVIDERS.LION.displayName
                    : PROVIDERS.PANDA.displayName,
              },
            ],
          });
        } else {
          const existing = servicesMap.get(metadata.key);
          existing.prices = existing.prices || {};
          existing.prices[metadata.providerId] = priceUSD;
          existing.capability =
            service.capability || existing.capability || "sms";
          if (
            !existing.providers.find((p: any) => p.id === metadata.providerId)
          ) {
            existing.providers.push({
              id: metadata.providerId,
              name: metadata.providerName,
              displayName:
                metadata.providerName === "sms-man"
                  ? PROVIDERS.LION.displayName
                  : PROVIDERS.PANDA.displayName,
            });
          }
        }
      });

      const result: AggregatedServicesPayload = {
        services: Array.from(servicesMap.values()),
        providers,
        exchangeRate: {
          usdToNgn: usdToNgnRate,
          usdToRub: rubToUsdRate,
          source: "server",
          timestamp: new Date().toISOString(),
        },
      };

      // Refuse to cache a partial result that has no Lion (SMS-Man) services,
      // but still return it as a one-off fallback response instead of failing 503.
      if (smsManServices.length === 0) {
        console.warn(
          "[Build] SMS-Man returned 0 services — skipping cache write and returning uncached fallback payload",
        );
        return result;
      }

      // Embed cachedAt timestamp so stale-while-revalidate can check cache age
      const now = Date.now();
      const resultJson = JSON.stringify({ ...result, cachedAt: now });
      memoryCache = {
        data: resultJson,
        expiresAt: now + SERVICES_CACHE_TTL_SECONDS * 1000,
        cachedAt: now,
      };
      try {
        await redis.set(
          SERVICES_CACHE_KEY,
          resultJson,
          SERVICES_CACHE_TTL_SECONDS,
        );
      } catch {
        console.warn(
          "[Build] Redis write failed (OOM?), using memory cache only",
        );
      }

      console.log(
        `[Build] ✓ Cache built: ${result.services.length} unique services`,
        `(SMS-Man: ${smsManServices.length}, TextVerified: ${tvServices.length})`,
      );
      return result;
    } finally {
      refreshInProgress = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// Export for the public catalog route so it can trigger population on cold cache
export { buildAndCacheServices };

export const revalidate = 3600; // 1h CDN revalidation for the public services catalog

export async function GET() {
  console.log("\n╔════════════════════════════════════════════════╗");
  console.log("║   GET /api/orders/services - Provider Aggregator (public catalog)");
  console.log("╚════════════════════════════════════════════════╝");
  try {
    // Catalog is not user-specific. Make auth optional so CDN can cache the response globally.
    // Logged-in users still get the data; unauthenticated also works for the buy flow.
    try {
      const authResult = await requireAuth();
      console.log(`[Auth] ✓ User ${authResult?.user?.email} authenticated (optional)`);
    } catch {
      console.log("[Auth] Serving public catalog (no auth)");
    }

    // ── Stale-while-revalidate cache ─────────────────────────────────────────
    // Always return cached data immediately. If the data is older than
    // SERVICES_STALE_AFTER_SECONDS, kick off a background rebuild so the
    // *next* request benefits — no user ever waits for the expensive fetch.
    const serveCache = async (
      raw: string,
      source: string,
    ): Promise<Response> => {
      const parsed = JSON.parse(raw) as Record<string, unknown> & {
        cachedAt?: number;
        services?: Array<{ providers?: Array<{ id: string }> }>;
      };

      // Validate: if the cached payload has no Lion services, it was built during
      // an SMS-Man timeout. Force a synchronous rebuild rather than serving it.
      const hasLion =
        Array.isArray(parsed.services) &&
        parsed.services.some((s) =>
          s.providers?.some((p) => p.id === PROVIDERS.LION.id),
        );
      if (!hasLion) {
        console.warn(
          `[Cache] ${source} contains no Lion services — discarding and rebuilding synchronously`,
        );
        // Delete poisoned cache entries so they are not served again
        try {
          await redis.del(SERVICES_CACHE_KEY);
        } catch {
          /* ignore */
        }
        memoryCache = null;
        const rebuilt = await buildAndCacheServices();
        // Use `as` cast to escape TypeScript's control-flow narrowing of the module-level variable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const freshCacheData = memoryCache as any as {
          data: string;
          expiresAt: number;
        } | null;
        if (freshCacheData) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { cachedAt, ...rest } = JSON.parse(
            freshCacheData.data,
          ) as Record<string, unknown> & { cachedAt?: number };
          return json({ ok: true, data: rest }, {
            headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
          });
        }
        if (rebuilt) {
          return json({ ok: true, data: rebuilt }, {
            headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
          });
        }
        return error(
          "No services available from providers. Please check API keys and try again.",
          503,
        );
      }

      const ageSeconds = (Date.now() - (parsed.cachedAt ?? 0)) / 1000;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { cachedAt, services: _s, ...clientData } = parsed;
      const clientPayload = { ...clientData, services: parsed.services };

      if (ageSeconds > SERVICES_STALE_AFTER_SECONDS && !refreshInProgress) {
        console.log(
          `[Cache] ${source} is ${Math.round(ageSeconds / 60)}min old — rebuilding in background`,
        );
        void buildAndCacheServices();
      } else {
        console.log(
          `[Cache] ✓ Serving ${source} (${Math.round(ageSeconds / 60)}min old, ${parsed.services?.length ?? 0} services, has Lion: yes)`,
        );
      }
      console.log("╚════════════════════════════════════════════════╝\n");
      return json({ ok: true, data: clientPayload }, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    };

    try {
      const cached = await redis.get(SERVICES_CACHE_KEY);
      if (cached) return await serveCache(cached, "Redis cache");
    } catch {
      console.warn("[Cache] Redis read failed, checking memory cache");
    }

    if (memoryCache && Date.now() < memoryCache.expiresAt) {
      return await serveCache(memoryCache.data, "memory cache");
    }

    // ── Cache miss: build synchronously then serve ────────────────────────────────────
    console.log("[Cache] Miss — building synchronously...");
    const built = await buildAndCacheServices();

    if (memoryCache) {
      return await serveCache(memoryCache.data, "fresh build");
    }

    if (built) {
      console.log(
        "[Cache] Serving uncached fallback payload (cache write skipped)",
      );
      console.log("╚════════════════════════════════════════════════╝\n");
      return json({ ok: true, data: built }, {
        headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
      });
    }

    // Both providers returned empty sets
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
