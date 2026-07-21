import { prisma } from "@/lib/server/prisma";

/**
 * PricingService - Applies admin-configured pricing rules to calculate final prices.
 *
 * Formula (always):
 *   finalPrice = providerBaseCost + markup
 *
 * Markup:
 *   - PERCENTAGE: baseCost * (profitValue / 100)  [currency-agnostic]
 *   - FIXED + USD: profitValue dollars added to base (base is USD)
 *   - FIXED + NGN: profitValue naira converted to USD via rate, then added
 *
 * All intermediate prices are kept in USD so the services catalogue and
 * order path can convert to NGN with the current exchange rate.
 *
 * Matching priority:
 * 1. Higher priority rules take precedence
 * 2. More specific rules (service + country) override general rules
 * 3. If no rule matches, a default fallback markup is applied
 */

export type ProfitCurrencyCode = "USD" | "NGN";

interface PricingResult {
  basePrice: number; // USD
  profit: number; // USD (markup converted to USD when needed)
  finalPrice: number; // USD = basePrice + profit
  ruleApplied: {
    id: string | null;
    serviceCode: string | null;
    country: string | null;
    profitType: string;
    profitValue: number;
    profitCurrency: ProfitCurrencyCode;
    priority: number;
  } | null;
}

interface PricingRuleRow {
  id: string;
  serviceCode: string | null;
  country: string | null;
  profitType: string;
  profitValue: number;
  profitCurrency: ProfitCurrencyCode;
  priority: number;
}

// Default fallback if no pricing rule is configured
const DEFAULT_MARKUP = {
  profitType: "PERCENTAGE" as const,
  profitValue: 20, // 20% default markup
};

function normalizeCurrency(
  value: string | null | undefined,
): ProfitCurrencyCode {
  return value === "NGN" ? "NGN" : "USD";
}

/**
 * Compute profit (markup) in USD for a given base USD price and rule.
 */
function computeProfitUsd(
  basePriceUsd: number,
  profitType: string,
  profitValue: number,
  profitCurrency: ProfitCurrencyCode,
  usdToNgnRate: number,
): number {
  if (profitType === "PERCENTAGE") {
    return basePriceUsd * (profitValue / 100);
  }

  // FIXED
  if (profitCurrency === "NGN") {
    // Convert NGN fixed markup → USD so final stays in USD
    if (!usdToNgnRate || usdToNgnRate <= 0) {
      console.warn(
        "[PricingService] Invalid usdToNgnRate for NGN fixed markup; treating value as USD",
      );
      return profitValue;
    }
    return profitValue / usdToNgnRate;
  }

  // FIXED USD
  return profitValue;
}

export class PricingService {
  /**
   * Find the best matching pricing rule for a service/country combination.
   * Rules are matched in this priority order:
   * 1. Exact match (serviceCode + country)
   * 2. Service only (serviceCode + any country)
   * 3. Country only (any service + country)
   * 4. Global (any service + any country)
   *
   * Within each category, higher priority rules take precedence.
   */
  static async findBestPricingRule(
    serviceCode: string,
    country: string,
  ): Promise<PricingRuleRow | null> {
    // Fetch all active pricing rules ordered by priority (highest first)
    const rules = await prisma.pricingRule.findMany({
      where: {
        isActive: true,
        OR: [
          { serviceCode, country },
          { serviceCode, country: null },
          { serviceCode: null, country },
          { serviceCode: null, country: null },
        ],
      },
      orderBy: { priority: "desc" },
    });

    if (rules.length === 0) return null;

    // Score each rule based on specificity and priority
    const scoreRule = (rule: (typeof rules)[0]): number => {
      let score = rule.priority * 100;
      if (rule.serviceCode && rule.country) score += 1000;
      else if (rule.serviceCode) score += 500;
      else if (rule.country) score += 250;
      return score;
    };

    const scoredRules = rules.map((rule) => ({
      rule,
      score: scoreRule(rule),
    }));

    scoredRules.sort((a, b) => b.score - a.score);

    const bestRule = scoredRules[0].rule;
    return {
      id: bestRule.id,
      serviceCode: bestRule.serviceCode,
      country: bestRule.country,
      profitType: bestRule.profitType,
      profitValue: Number(bestRule.profitValue),
      profitCurrency: normalizeCurrency(
        (bestRule as { profitCurrency?: string }).profitCurrency,
      ),
      priority: bestRule.priority,
    };
  }

  /**
   * Calculate the final price by applying the matching pricing rule.
   *
   * @param basePrice - Provider cost in USD
   * @param serviceCode - Service code
   * @param country - Country code
   * @param usdToNgnRate - Required when any FIXED+NGN rule may apply
   */
  static async calculatePrice(
    basePrice: number,
    serviceCode: string,
    country: string,
    usdToNgnRate: number = 1600,
  ): Promise<PricingResult> {
    const rule = await this.findBestPricingRule(serviceCode, country);

    let profit = 0;
    let appliedRule: PricingResult["ruleApplied"] = null;

    if (rule) {
      profit = computeProfitUsd(
        basePrice,
        rule.profitType,
        rule.profitValue,
        rule.profitCurrency,
        usdToNgnRate,
      );
      appliedRule = rule;

      const currencyNote =
        rule.profitType === "FIXED" ? ` ${rule.profitCurrency}` : "";
      console.log(
        `[PricingService] Rule applied: ${rule.id} (${
          rule.serviceCode || "*"
        }/${rule.country || "*"}) - ${rule.profitType} ${rule.profitValue}${
          rule.profitType === "PERCENTAGE" ? "%" : currencyNote
        } → +$${profit.toFixed(4)} USD markup`,
      );
    } else {
      profit = basePrice * (DEFAULT_MARKUP.profitValue / 100);
      console.log(
        `[PricingService] No rule found, using default ${DEFAULT_MARKUP.profitValue}% markup`,
      );
    }

    const finalPrice = basePrice + profit;

    return {
      basePrice,
      profit,
      finalPrice,
      ruleApplied: appliedRule,
    };
  }

  /**
   * Batch calculate prices for multiple services.
   * Optimized to fetch pricing rules once and apply them to all services.
   *
   * @param services - Array of {basePrice (USD), serviceCode, country}
   * @param usdToNgnRate - Used to convert FIXED NGN markups into USD
   */
  static async calculatePrices(
    services: Array<{
      basePrice: number;
      serviceCode: string;
      country: string;
    }>,
    usdToNgnRate: number = 1600,
  ): Promise<PricingResult[]> {
    const allRules = await prisma.pricingRule.findMany({
      where: { isActive: true },
      orderBy: { priority: "desc" },
    });

    const results: PricingResult[] = [];

    for (const service of services) {
      const matchingRules = allRules.filter((rule) => {
        const serviceMatch =
          rule.serviceCode === null || rule.serviceCode === service.serviceCode;
        const countryMatch =
          rule.country === null || rule.country === service.country;
        return serviceMatch && countryMatch;
      });

      let profit = 0;
      let appliedRule: PricingResult["ruleApplied"] = null;

      if (matchingRules.length > 0) {
        const scoreRule = (rule: (typeof allRules)[0]): number => {
          let score = rule.priority * 100;
          if (rule.serviceCode && rule.country) score += 1000;
          else if (rule.serviceCode) score += 500;
          else if (rule.country) score += 250;
          return score;
        };

        const scoredRules = matchingRules.map((rule) => ({
          rule,
          score: scoreRule(rule),
        }));
        scoredRules.sort((a, b) => b.score - a.score);

        const bestRule = scoredRules[0].rule;
        const profitCurrency = normalizeCurrency(
          (bestRule as { profitCurrency?: string }).profitCurrency,
        );
        const profitValue = Number(bestRule.profitValue);

        profit = computeProfitUsd(
          service.basePrice,
          bestRule.profitType,
          profitValue,
          profitCurrency,
          usdToNgnRate,
        );

        appliedRule = {
          id: bestRule.id,
          serviceCode: bestRule.serviceCode,
          country: bestRule.country,
          profitType: bestRule.profitType,
          profitValue,
          profitCurrency,
          priority: bestRule.priority,
        };
      } else {
        profit = service.basePrice * (DEFAULT_MARKUP.profitValue / 100);
      }

      results.push({
        basePrice: service.basePrice,
        profit,
        finalPrice: service.basePrice + profit,
        ruleApplied: appliedRule,
      });
    }

    return results;
  }

  /**
   * Get all active pricing rules for display/debugging purposes.
   */
  static async getAllActiveRules() {
    return await prisma.pricingRule.findMany({
      where: { isActive: true },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });
  }
}
