/**
 * Services Catalog Service
 *
 * Splits the former ~54MB monolithic services payload into:
 *  1. A lightweight catalog (unique services + providers + exchange rate) — tens of KB
 *  2. Per-service country/price rows, served on demand
 *
 * Server keeps the country index in memory; clients never download the full matrix.
 */

import { PROVIDERS } from "@/lib/constants/providers";
import { SMSManService } from "@/lib/server/services/order.service";
import { TextVerifiedService } from "@/lib/server/services/textverified.service";
import { ExchangeRateService } from "@/lib/server/services/exchange-rate.service";
import { PricingService } from "@/lib/server/services/pricing.service";

const SERVICES_CACHE_TTL_SECONDS = 90 * 60; // 90 min hard expiry
const SERVICES_STALE_AFTER_SECONDS = 24 * 60; // background refresh after 24 min
const PROVIDER_FETCH_TIMEOUT_MS = 60_000;
const TV_DEFAULT_BASE_PRICE_USD = 2.5;

export type CatalogProvider = {
  id: string;
  name: string;
  displayName: string;
  logo?: string;
  cover: string;
};

export type CatalogServiceItem = {
  code: string;
  name: string;
  providers: Array<{
    id: string;
    name: string;
    displayName: string;
  }>;
  capability?: string;
  ui?: {
    logo: string;
    color: string;
    displayName: string;
  };
};

export type CountryPriceItem = {
  code: string;
  name: string;
  priceUsd: number;
};

export type ExchangeRateInfo = {
  usdToNgn: number;
  usdToRub: number;
  source: string;
  timestamp: string;
};

export type CatalogPayload = {
  services: CatalogServiceItem[];
  providers: CatalogProvider[];
  exchangeRate: ExchangeRateInfo;
};

type CatalogCacheStore = {
  catalog: CatalogPayload;
  /** Key: `${providerId}:${serviceCode.toLowerCase()}` */
  countriesIndex: Map<string, CountryPriceItem[]>;
  cachedAt: number;
  expiresAt: number;
};

let memoryCache: CatalogCacheStore | null = null;
/** Fast skeleton (names only) served while the full price index builds. */
let skeletonCatalog: CatalogPayload | null = null;
let refreshInProgress = false;
let refreshPromise: Promise<CatalogCacheStore | null> | null = null;

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
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function countriesKey(providerId: string, serviceCode: string): string {
  return `${providerId}:${serviceCode.toLowerCase()}`;
}

function providerMeta(providerId: string, providerName: string) {
  const isLion = providerId === PROVIDERS.LION.id || providerName === "sms-man";
  return {
    id: isLion ? PROVIDERS.LION.id : PROVIDERS.PANDA.id,
    name: isLion ? "sms-man" : "textverified",
    displayName: isLion
      ? PROVIDERS.LION.displayName
      : PROVIDERS.PANDA.displayName,
  };
}

/**
 * Build the split catalog from provider APIs and write to memory cache.
 * Concurrent callers coalesce onto a single in-flight build.
 */
export async function buildAndCacheServices(): Promise<CatalogCacheStore | null> {
  if (refreshInProgress && refreshPromise) {
    return refreshPromise;
  }

  refreshInProgress = true;
  refreshPromise = (async () => {
    try {
      console.log("[CatalogBuild] Starting split catalog build...");
      const rubToUsdRate = await ExchangeRateService.getUsdToRubRate();
      const usdToNgnRate = await ExchangeRateService.getUsdToNgnRate();
      console.log(
        `[CatalogBuild] Rates: 1 USD = ${rubToUsdRate} RUB, 1 USD = ${usdToNgnRate} NGN`,
      );

      const providers: CatalogProvider[] = [
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

      console.log("[CatalogBuild] Fetching provider services in parallel...");
      const [smsManResult, tvResult] = await Promise.allSettled([
        withTimeout(
          (async () => {
            const smsManService = new SMSManService();
            const services = await smsManService.getAvailableServices();
            console.log(
              `[SMSMan] ✓ Fetched ${services.length} service×country rows`,
            );
            return services;
          })(),
          "SMS-Man service fetch",
          60_000,
        ),
        withTimeout(
          (async () => {
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
            return services;
          })(),
          "TextVerified service fetch",
          25_000,
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
          "[CatalogBuild] No services from any provider — skipping cache write",
        );
        return null;
      }

      // Batch pricing input (still needed for markup), but we never emit the
      // expanded matrix to clients — only unique services + country index.
      const servicesToPrice: Array<{
        basePrice: number;
        serviceCode: string;
        country: string;
      }> = [];
      const serviceMetadata: Array<{
        code: string;
        name: string;
        country: string;
        countryName?: string;
        providerId: string;
        providerName: string;
        capability?: string;
      }> = [];

      smsManServices.forEach((service: any) => {
        const baseUSD = Number((service.price / rubToUsdRate).toFixed(4));
        servicesToPrice.push({
          basePrice: baseUSD,
          serviceCode: service.code,
          country: service.country,
        });
        serviceMetadata.push({
          code: service.code,
          name: service.name,
          country: service.country,
          countryName: service.countryName,
          providerId: PROVIDERS.LION.id,
          providerName: "sms-man",
        });
      });

      tvServices.forEach((service: any) => {
        const code = service.serviceName || service.code;
        servicesToPrice.push({
          basePrice: service.price || 0,
          serviceCode: code,
          country: "US",
        });
        serviceMetadata.push({
          code,
          name: service.serviceName || service.name || code,
          country: "US",
          countryName: "United States",
          providerId: PROVIDERS.PANDA.id,
          providerName: "textverified",
          capability: service.capability,
        });
      });

      console.log(
        `[CatalogBuild] Pricing ${servicesToPrice.length} rows (SMS-Man: ${smsManServices.length}, TV: ${tvServices.length})...`,
      );
      const pricingResults = await PricingService.calculatePrices(
        servicesToPrice,
        usdToNgnRate,
      );

      // Unique service index + countries-by-provider-service map
      const servicesMap = new Map<string, CatalogServiceItem>();
      const countriesIndex = new Map<string, CountryPriceItem[]>();
      // Dedup country rows within a service (keep cheapest if duplicates)
      const countrySeen = new Map<string, number>(); // key -> price index

      pricingResults.forEach((priceResult, idx) => {
        const meta = serviceMetadata[idx];
        if (!meta?.code) return;

        const priceUSD = Number(priceResult.finalPrice.toFixed(2));
        const pMeta = providerMeta(meta.providerId, meta.providerName);
        const codeKey = meta.code.toLowerCase();

        // Unique catalog entry per service code
        let entry = servicesMap.get(codeKey);
        if (!entry) {
          entry = {
            code: meta.code,
            name: meta.name,
            capability: meta.capability || "sms",
            ui: {
              logo: "📱",
              color: "bg-gray-200",
              displayName: meta.name,
            },
            providers: [pMeta],
          };
          servicesMap.set(codeKey, entry);
        } else {
          if (!entry.providers.find((p) => p.id === pMeta.id)) {
            entry.providers.push(pMeta);
          }
          if (meta.capability) entry.capability = meta.capability;
          // Prefer a human name if we only had a code before
          if (meta.name && meta.name !== meta.code) {
            entry.name = meta.name;
            if (entry.ui) entry.ui.displayName = meta.name;
          }
        }

        // Country price row for this provider+service
        const cKey = countriesKey(pMeta.id, meta.code);
        const countryCode = String(meta.country || "").toUpperCase();
        if (!countryCode) return;

        const dedupeKey = `${cKey}:${countryCode}`;
        const existingIdx = countrySeen.get(dedupeKey);
        if (existingIdx !== undefined) {
          const list = countriesIndex.get(cKey)!;
          if (priceUSD < list[existingIdx].priceUsd) {
            list[existingIdx] = {
              code: countryCode,
              name: meta.countryName || countryCode,
              priceUsd: priceUSD,
            };
          }
          return;
        }

        if (!countriesIndex.has(cKey)) {
          countriesIndex.set(cKey, []);
        }
        const list = countriesIndex.get(cKey)!;
        countrySeen.set(dedupeKey, list.length);
        list.push({
          code: countryCode,
          name: meta.countryName || countryCode,
          priceUsd: priceUSD,
        });
      });

      // Sort country lists by name for stable UI
      for (const list of countriesIndex.values()) {
        list.sort((a, b) => a.name.localeCompare(b.name));
      }

      const catalog: CatalogPayload = {
        services: Array.from(servicesMap.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
        providers,
        exchangeRate: {
          usdToNgn: usdToNgnRate,
          usdToRub: rubToUsdRate,
          source: "server",
          timestamp: new Date().toISOString(),
        },
      };

      const now = Date.now();
      const store: CatalogCacheStore = {
        catalog,
        countriesIndex,
        cachedAt: now,
        expiresAt: now + SERVICES_CACHE_TTL_SECONDS * 1000,
      };

      // Only hard-cache when Lion (SMS-Man) data is present — partial builds
      // are still returned as one-off fallbacks.
      if (smsManServices.length === 0) {
        console.warn(
          "[CatalogBuild] SMS-Man empty — returning uncached fallback (not stored)",
        );
        return store;
      }

      memoryCache = store;
      console.log(
        `[CatalogBuild] ✓ Cache built: ${catalog.services.length} unique services, ` +
          `${countriesIndex.size} provider×service country lists ` +
          `(raw rows: SMS-Man ${smsManServices.length}, TV ${tvServices.length})`,
      );
      return store;
    } finally {
      refreshInProgress = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function isCacheFresh(cache: CatalogCacheStore): boolean {
  return Date.now() < cache.expiresAt;
}

function hasLionServices(cache: CatalogCacheStore): boolean {
  return cache.catalog.services.some((s) =>
    s.providers.some((p) => p.id === PROVIDERS.LION.id),
  );
}

/**
 * Build a names-only catalog from lightweight provider endpoints (no price matrix).
 * Completes in seconds so the buy page can render while full pricing indexes in background.
 */
async function buildSkeletonCatalog(): Promise<CatalogPayload | null> {
  try {
    console.log("[Catalog] Building fast skeleton catalog...");
    const [usdToNgnRate, rubToUsdRate, smsAppsResult, tvResult] =
      await Promise.all([
        ExchangeRateService.getUsdToNgnRate(),
        ExchangeRateService.getUsdToRubRate(),
        withTimeout(
          new SMSManService().listApplications(),
          "SMS-Man applications",
          15_000,
        ).catch((e) => {
          console.warn("[Catalog] Skeleton SMS-Man apps failed:", e);
          return [] as Array<{ id: string; code: string; name: string }>;
        }),
        withTimeout(
          new TextVerifiedService().getAvailableServices(),
          "TextVerified services",
          15_000,
        ).catch((e) => {
          console.warn("[Catalog] Skeleton TextVerified failed:", e);
          return [] as Array<{ serviceName?: string; capability?: string }>;
        }),
      ]);

    const lionMeta = providerMeta(PROVIDERS.LION.id, "sms-man");
    const pandaMeta = providerMeta(PROVIDERS.PANDA.id, "textverified");
    const servicesMap = new Map<string, CatalogServiceItem>();

    for (const app of smsAppsResult) {
      if (!app?.code) continue;
      const key = app.code.toLowerCase();
      servicesMap.set(key, {
        code: app.code,
        name: app.name || app.code,
        capability: "sms",
        ui: {
          logo: "📱",
          color: "bg-gray-200",
          displayName: app.name || app.code,
        },
        providers: [lionMeta],
      });
    }

    for (const svc of tvResult) {
      const code = (svc as any).serviceName || (svc as any).code;
      if (!code) continue;
      const key = String(code).toLowerCase();
      const existing = servicesMap.get(key);
      if (existing) {
        if (!existing.providers.find((p) => p.id === pandaMeta.id)) {
          existing.providers.push(pandaMeta);
        }
        if ((svc as any).capability) {
          existing.capability = (svc as any).capability;
        }
      } else {
        servicesMap.set(key, {
          code: String(code),
          name: String(code),
          capability: (svc as any).capability || "sms",
          ui: {
            logo: "📱",
            color: "bg-gray-200",
            displayName: String(code),
          },
          providers: [pandaMeta],
        });
      }
    }

    if (servicesMap.size === 0) return null;

    const catalog: CatalogPayload = {
      services: Array.from(servicesMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      providers: [
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
      ],
      exchangeRate: {
        usdToNgn: usdToNgnRate,
        usdToRub: rubToUsdRate,
        source: "server",
        timestamp: new Date().toISOString(),
      },
    };

    skeletonCatalog = catalog;
    console.log(
      `[Catalog] ✓ Skeleton ready: ${catalog.services.length} unique services (no prices yet)`,
    );
    return catalog;
  } catch (e) {
    console.error("[Catalog] Skeleton build failed:", e);
    return null;
  }
}

/**
 * Get the lightweight catalog. Uses stale-while-revalidate:
 * returns cached data immediately when available; refreshes in background
 * when past the soft-stale window.
 *
 * Cold path: returns a fast names-only skeleton and builds the full
 * countries/price index in the background so "Loading services..." is seconds, not minutes.
 */
export async function getServicesCatalog(): Promise<CatalogPayload | null> {
  if (memoryCache && isCacheFresh(memoryCache) && hasLionServices(memoryCache)) {
    const ageSeconds = (Date.now() - memoryCache.cachedAt) / 1000;
    if (ageSeconds > SERVICES_STALE_AFTER_SECONDS && !refreshInProgress) {
      console.log(
        `[Catalog] Serving stale catalog (${Math.round(ageSeconds / 60)}min) — background refresh`,
      );
      void buildAndCacheServices();
    } else {
      console.log(
        `[Catalog] ✓ Memory hit (${Math.round(ageSeconds / 60)}min, ${memoryCache.catalog.services.length} services)`,
      );
    }
    return memoryCache.catalog;
  }

  // Poisoned / partial cache without Lion — discard
  if (memoryCache && !hasLionServices(memoryCache)) {
    console.warn("[Catalog] Discarding cache without Lion services");
    memoryCache = null;
  }

  // Full cache miss: serve skeleton immediately, build prices in background.
  // First request after deploy no longer blocks on the ~100k-row price matrix.
  if (skeletonCatalog && skeletonCatalog.services.length > 0) {
    console.log(
      `[Catalog] ✓ Serving skeleton (${skeletonCatalog.services.length} services) — full index building`,
    );
    if (!refreshInProgress) {
      void buildAndCacheServices();
    }
    return skeletonCatalog;
  }

  console.log("[Catalog] Cold start — building skeleton then full index...");
  const skeleton = await buildSkeletonCatalog();

  // Kick full build (prices + countries index) without blocking the catalog response
  if (!refreshInProgress) {
    void buildAndCacheServices();
  }

  if (skeleton) return skeleton;

  // Skeleton failed — fall back to synchronous full build
  console.log("[Catalog] Skeleton failed — falling back to full build...");
  const built = await buildAndCacheServices();
  return built?.catalog ?? null;
}

/**
 * Countries + prices for one service under one provider.
 * If the full price index is still building (skeleton-only phase), waits for it.
 */
export async function getCountriesForService(
  serviceCode: string,
  providerId: string,
): Promise<{
  countries: CountryPriceItem[];
  exchangeRate: ExchangeRateInfo | null;
} | null> {
  // Ensure full countries index is available (may wait on first cold request)
  if (!memoryCache || !isCacheFresh(memoryCache) || !hasLionServices(memoryCache)) {
    console.log(
      `[Catalog] Countries for ${serviceCode} need full index — waiting for build...`,
    );
    const built = await buildAndCacheServices();
    if (!built) return null;
  }

  if (!memoryCache) {
    return null;
  }

  const ageSeconds = (Date.now() - memoryCache.cachedAt) / 1000;
  if (ageSeconds > SERVICES_STALE_AFTER_SECONDS && !refreshInProgress) {
    void buildAndCacheServices();
  }

  const key = countriesKey(providerId, serviceCode);
  let resolved = memoryCache.countriesIndex.get(key) || [];

  // Fallback: try alternate provider id aliases
  if (resolved.length === 0) {
    const aliases =
      providerId === "lion" || providerId === "sms-man"
        ? [PROVIDERS.LION.id, "sms-man"]
        : providerId === "panda" || providerId === "textverified"
          ? [PROVIDERS.PANDA.id, "textverified"]
          : [providerId];
    for (const alias of aliases) {
      const alt = memoryCache.countriesIndex.get(
        countriesKey(alias, serviceCode),
      );
      if (alt && alt.length > 0) {
        resolved = alt;
        break;
      }
    }
  }

  return {
    countries: resolved,
    exchangeRate: memoryCache.catalog.exchangeRate,
  };
}

/**
 * Lookup a single service+country price (USD with markup) from the index.
 * Useful for order creation validation without the old bloated payload.
 */
export async function getServiceCountryPrice(
  serviceCode: string,
  providerId: string,
  countryCode: string,
): Promise<number | null> {
  const result = await getCountriesForService(serviceCode, providerId);
  if (!result) return null;
  const country = result.countries.find(
    (c) => c.code.toUpperCase() === countryCode.toUpperCase(),
  );
  return country?.priceUsd ?? null;
}

/** Expose cache age for diagnostics / Cache-Control decisions */
export function getCatalogCacheMeta(): {
  cachedAt: number | null;
  serviceCount: number;
  countryListCount: number;
} {
  if (!memoryCache) {
    return { cachedAt: null, serviceCount: 0, countryListCount: 0 };
  }
  return {
    cachedAt: memoryCache.cachedAt,
    serviceCount: memoryCache.catalog.services.length,
    countryListCount: memoryCache.countriesIndex.size,
  };
}

/**
 * Legacy compatibility: produce the old flat services array shape from the
 * split index. Prefer getServicesCatalog() for new clients.
 * Intentionally NOT used by the buy-flow UI (too large).
 */
export async function getLegacyFlatServicesPayload(): Promise<{
  services: unknown[];
  providers: CatalogProvider[];
  exchangeRate: ExchangeRateInfo;
} | null> {
  const catalog = await getServicesCatalog();
  if (!catalog || !memoryCache) return null;

  // Rebuild a limited flat list only if something still needs it —
  // keep this for rare admin/debug callers, not the hot path.
  const services: unknown[] = [];
  for (const svc of catalog.services) {
    for (const p of svc.providers) {
      const key = countriesKey(p.id, svc.code);
      const countries = memoryCache.countriesIndex.get(key) || [];
      for (const c of countries) {
        services.push({
          code: svc.code,
          name: svc.name,
          country: c.code,
          price: c.priceUsd,
          prices: { [p.id]: c.priceUsd },
          currency: "USD",
          capability: svc.capability || "sms",
          ui: svc.ui,
          providers: [p],
        });
      }
    }
  }

  return {
    services,
    providers: catalog.providers,
    exchangeRate: catalog.exchangeRate,
  };
}
