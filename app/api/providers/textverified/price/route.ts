import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { TextVerifiedService } from "@/lib/server/services/textverified.service";
import { ExchangeRateService } from "@/lib/server/services/exchange-rate.service";
import { PricingService } from "@/lib/server/services/pricing.service";

export const runtime = "nodejs";

/**
 * GET /api/providers/textverified/price
 * Fetches the price for a single TextVerified service with admin-configured profit markup applied, returned in NGN.
 * @param {NextRequest} req - serviceName: string
 */
export async function GET(req: NextRequest) {
  const serviceName = req.nextUrl.searchParams.get("serviceName");
  const capabilityParam = req.nextUrl.searchParams.get("capability");

  if (!serviceName) {
    return error("serviceName is required", 400);
  }

  // Use the capability from the query string (passed from service data), default to "sms"
  const capability = (
    ["sms", "voice", "smsAndVoiceCombo"].includes(capabilityParam || "")
      ? capabilityParam
      : "sms"
  ) as "sms" | "voice" | "smsAndVoiceCombo";

  try {
    const textVerifiedService = new TextVerifiedService();

    // 1. Get base USD price from TextVerified using the new pricing API
    // Try with the given capability first, then retry with alternatives if it fails
    let baseUsdPrice: number | null = null;
    const capabilitiesToTry: Array<"sms" | "voice" | "smsAndVoiceCombo"> = [
      capability,
      ...(capability !== "sms" ? ["sms" as const] : []),
      ...(capability !== "voice" ? ["voice" as const] : []),
      ...(capability !== "smsAndVoiceCombo"
        ? ["smsAndVoiceCombo" as const]
        : []),
    ];

    for (const cap of capabilitiesToTry) {
      try {
        const result = await textVerifiedService.getServicePricing({
          serviceName,
          areaCode: false,
          carrier: false,
          numberType: "mobile",
          capability: cap,
        });
        if (result.price > 0) {
          baseUsdPrice = result.price;
          console.log(
            `[TextVerified][Price] Got price for ${serviceName} with capability=${cap}: $${result.price}`,
          );
          break;
        }
      } catch (e) {
        console.warn(
          `[TextVerified][Price] Pricing failed for ${serviceName} with capability=${cap}: ${(e as Error).message}`,
        );
        continue;
      }
    }

    if (baseUsdPrice === null || baseUsdPrice <= 0) {
      console.warn(
        `[TextVerified][Price] No valid price found for ${serviceName} after trying all capabilities`,
      );
      return error(`Price not available for service: ${serviceName}`, 404);
    }

    // 2. Get exchange rate
    const usdToNgn = await ExchangeRateService.getUsdToNgnRate();

    // 3. Apply admin pricing rules (TextVerified is always US)
    // final = providerBase + markup (FIXED may be USD or NGN)
    const pricingResult = await PricingService.calculatePrice(
      baseUsdPrice,
      serviceName,
      "US",
      usdToNgn,
    );

    const finalUsdPrice = pricingResult.finalPrice;
    const profitUsd = pricingResult.profit;

    // 4. Convert to NGN
    const finalNgnPrice = Math.round(finalUsdPrice * usdToNgn);

    const ruleNote = pricingResult.ruleApplied
      ? `(Rule: ${pricingResult.ruleApplied.profitType} ${
          pricingResult.ruleApplied.profitValue
        }${
          pricingResult.ruleApplied.profitType === "PERCENTAGE"
            ? "%"
            : ` ${pricingResult.ruleApplied.profitCurrency}`
        })`
      : "(Default 20% markup)";

    console.log(
      `[TextVerified][Price] ${serviceName}: Base $${baseUsdPrice.toFixed(
        2,
      )} + profit $${profitUsd.toFixed(2)} = $${finalUsdPrice.toFixed(
        2,
      )} → ₦${finalNgnPrice.toLocaleString()}`,
      ruleNote,
    );

    return json({
      ok: true,
      data: {
        serviceName,
        price: finalNgnPrice, // Return NGN price
        baseUsd: baseUsdPrice,
        profitUsd: profitUsd,
        finalUsd: finalUsdPrice,
        ruleApplied: pricingResult.ruleApplied,
      },
    });
  } catch (e) {
    const err = e as Error;
    console.error(
      `[API][TextVerified][Price] Failed to fetch price for ${serviceName}:`,
      err,
    );
    return error(err.message, 500);
  }
}
