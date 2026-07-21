import { prisma } from "@/lib/server/prisma";
import { Prisma } from "@/app/generated/prisma";

/**
 * Free exchange rates via MoneyConvert (https://moneyconvert.net/api/).
 * Endpoint: https://cdn.moneyconvert.net/api/latest.json
 * Base: USD. No API key required. Updated every ~5 minutes.
 */
const MONEYCONVERT_API_URL = "https://cdn.moneyconvert.net/api/latest.json";
const CACHE_DURATION_HOURS = 8; // Refresh every 8 hours (3 times daily)
const FALLBACK_USD_TO_NGN = 1600;
const FALLBACK_USD_TO_RUB = 100;

interface MoneyConvertResponse {
  base?: string;
  rates?: Record<string, number>;
  ts?: string;
  source?: string;
}

export class ExchangeRateService {
  /** In-process snapshot of the last successful full rates payload (avoids re-fetch per pair). */
  private static ratesSnapshot: {
    rates: Record<string, number>;
    fetchedAt: number;
  } | null = null;

  /**
   * Get exchange rate from cache or fetch from API if stale
   */
  static async getRate(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    if (fromCurrency === toCurrency) return 1;

    try {
      // Try to get from database cache
      const cached = await prisma.exchangeRate.findUnique({
        where: {
          fromCurrency_toCurrency: {
            fromCurrency,
            toCurrency,
          },
        },
      });

      // Check if cache is still valid (less than 8 hours old)
      const now = new Date();
      const cacheValid =
        cached &&
        now.getTime() - cached.updatedAt.getTime() <
          CACHE_DURATION_HOURS * 60 * 60 * 1000;

      if (cacheValid && cached) {
        console.log(
          `[ExchangeRate] ✓ Using cached rate: 1 ${fromCurrency} = ${
            cached.rate
          } ${toCurrency} (age: ${Math.round(
            (now.getTime() - cached.updatedAt.getTime()) / (1000 * 60),
          )}min)`,
        );
        return Number(cached.rate);
      }

      // Cache miss or stale - fetch from API
      console.log(
        `[ExchangeRate] Cache ${
          cached ? "stale" : "miss"
        } for ${fromCurrency}/${toCurrency}, fetching from MoneyConvert...`,
      );
      const rate = await this.fetchRateFromAPI(fromCurrency, toCurrency);

      // Update or create cache entry
      await prisma.exchangeRate.upsert({
        where: {
          fromCurrency_toCurrency: {
            fromCurrency,
            toCurrency,
          },
        },
        update: {
          rate: new Prisma.Decimal(rate),
          updatedAt: now,
        },
        create: {
          fromCurrency,
          toCurrency,
          rate: new Prisma.Decimal(rate),
        },
      });

      console.log(
        `[ExchangeRate] ✓ Cached new rate: 1 ${fromCurrency} = ${rate} ${toCurrency}`,
      );
      return rate;
    } catch (error) {
      console.error(
        `[ExchangeRate] Error getting rate for ${fromCurrency}/${toCurrency}:`,
        error,
      );
      // Try to return stale cache as fallback, but don't fail if DB is unavailable
      try {
        const staleCache = await prisma.exchangeRate.findUnique({
          where: {
            fromCurrency_toCurrency: {
              fromCurrency,
              toCurrency,
            },
          },
        });

        if (staleCache) {
          console.warn(
            `[ExchangeRate] ⚠ Using stale cache as fallback: ${staleCache.rate}`,
          );
          return Number(staleCache.rate);
        }
      } catch (dbErr) {
        console.warn(
          `[ExchangeRate] ⚠ Skipping stale cache lookup due to DB error:`,
          dbErr,
        );
      }

      // Return hardcoded fallback as last resort
      return this.getFallbackRate(fromCurrency, toCurrency);
    }
  }

  /**
   * Fetch rates from MoneyConvert free API (base USD).
   * Supports any pair by converting through USD.
   */
  private static async fetchRateFromAPI(
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    const rates = await this.fetchUsdBaseRates();

    if (fromCurrency === "USD") {
      const rate = rates[toCurrency];
      if (rate == null) {
        throw new Error(`Currency ${toCurrency} not found in MoneyConvert response`);
      }
      return rate;
    }

    if (toCurrency === "USD") {
      const fromPerUsd = rates[fromCurrency];
      if (fromPerUsd == null || fromPerUsd === 0) {
        throw new Error(`Currency ${fromCurrency} not found in MoneyConvert response`);
      }
      return 1 / fromPerUsd;
    }

    // Cross rate via USD: (to/USD) / (from/USD)
    const fromPerUsd = rates[fromCurrency];
    const toPerUsd = rates[toCurrency];
    if (fromPerUsd == null || toPerUsd == null || fromPerUsd === 0) {
      throw new Error(
        `Cannot compute ${fromCurrency}/${toCurrency}: missing rates in MoneyConvert response`,
      );
    }
    return toPerUsd / fromPerUsd;
  }

  /**
   * Fetch (and briefly cache in-process) the full USD-base rates map.
   */
  private static async fetchUsdBaseRates(): Promise<Record<string, number>> {
    const SNAPSHOT_TTL_MS = 5 * 60 * 1000; // 5 min in-process reuse
    if (
      this.ratesSnapshot &&
      Date.now() - this.ratesSnapshot.fetchedAt < SNAPSHOT_TTL_MS
    ) {
      return this.ratesSnapshot.rates;
    }

    const response = await fetch(MONEYCONVERT_API_URL, {
      next: { revalidate: 0 },
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(
        `MoneyConvert API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as MoneyConvertResponse;

    if (!data.rates || typeof data.rates !== "object") {
      throw new Error("MoneyConvert API returned invalid rates payload");
    }

    // Ensure USD is present
    const rates = { ...data.rates, USD: data.rates.USD ?? 1 };

    this.ratesSnapshot = { rates, fetchedAt: Date.now() };
    console.log(
      `[ExchangeRate] ✓ Fetched MoneyConvert rates (ts: ${data.ts || "n/a"}, currencies: ${Object.keys(rates).length})`,
    );
    return rates;
  }

  /**
   * Get hardcoded fallback rates (last resort).
   * USD/NGN defaults to 1600 as a stable business fallback.
   */
  private static getFallbackRate(
    fromCurrency: string,
    toCurrency: string,
  ): number {
    console.error(
      `[ExchangeRate] ✗ Using hardcoded fallback for ${fromCurrency}/${toCurrency}`,
    );

    if (fromCurrency === toCurrency) return 1;

    const ratesPerUsd: Record<string, number> = {
      USD: 1,
      NGN: FALLBACK_USD_TO_NGN,
      RUB: FALLBACK_USD_TO_RUB,
    };

    const fromPerUsd = ratesPerUsd[fromCurrency];
    const toPerUsd = ratesPerUsd[toCurrency];

    if (!fromPerUsd || !toPerUsd) {
      return 1;
    }

    if (fromCurrency === "USD") {
      return toPerUsd;
    }

    if (toCurrency === "USD") {
      return 1 / fromPerUsd;
    }

    return toPerUsd / fromPerUsd;
  }

  /**
   * Manually refresh all commonly used rates (can be called by cron job).
   * Forces a fresh API pull by clearing the in-process snapshot first.
   */
  static async refreshCommonRates(): Promise<void> {
    console.log("[ExchangeRate] Refreshing common exchange rates via MoneyConvert...");
    this.ratesSnapshot = null;

    const commonPairs = [
      { from: "USD", to: "NGN" },
      { from: "USD", to: "RUB" },
    ];

    // Force-refresh by writing fresh API values even if DB cache is still "valid"
    try {
      const rates = await this.fetchUsdBaseRates();
      const now = new Date();

      for (const pair of commonPairs) {
        try {
          let rate: number;
          if (pair.from === "USD") {
            rate = rates[pair.to];
          } else {
            rate = await this.fetchRateFromAPI(pair.from, pair.to);
          }
          if (rate == null) {
            throw new Error(`Missing rate for ${pair.from}/${pair.to}`);
          }

          await prisma.exchangeRate.upsert({
            where: {
              fromCurrency_toCurrency: {
                fromCurrency: pair.from,
                toCurrency: pair.to,
              },
            },
            update: {
              rate: new Prisma.Decimal(rate),
              updatedAt: now,
            },
            create: {
              fromCurrency: pair.from,
              toCurrency: pair.to,
              rate: new Prisma.Decimal(rate),
            },
          });
          console.log(
            `[ExchangeRate] ✓ Refreshed 1 ${pair.from} = ${rate} ${pair.to}`,
          );
        } catch (error) {
          console.error(
            `[ExchangeRate] Failed to refresh ${pair.from}/${pair.to}:`,
            error,
          );
        }
      }
    } catch (error) {
      console.error("[ExchangeRate] Failed to fetch MoneyConvert rates:", error);
      // Fall back to getRate which will use stale/hardcoded
      for (const pair of commonPairs) {
        try {
          await this.getRate(pair.from, pair.to);
        } catch {
          /* ignore */
        }
      }
    }

    console.log("[ExchangeRate] ✓ Refresh complete");
  }

  /**
   * Get USD/RUB rate (for SMS-Man conversion)
   */
  static async getUsdToRubRate(): Promise<number> {
    return this.getRate("USD", "RUB");
  }

  /**
   * Get USD/NGN rate (for Nigerian pricing)
   */
  static async getUsdToNgnRate(): Promise<number> {
    return this.getRate("USD", "NGN");
  }

  /**
   * Convert RUB to USD
   */
  static async convertRubToUsd(rubAmount: number): Promise<number> {
    const rate = await this.getUsdToRubRate();
    return rubAmount / rate;
  }

  /**
   * Convert USD to NGN
   */
  static async convertUsdToNgn(usdAmount: number): Promise<number> {
    const rate = await this.getUsdToNgnRate();
    return usdAmount * rate;
  }
}
