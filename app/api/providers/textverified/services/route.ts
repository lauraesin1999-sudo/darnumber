import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { TextVerifiedService } from "@/lib/server/services/textverified.service";
import { requireAuth } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * GET /api/providers/textverified/services
 * Fetches available services from TextVerified API
 * Query parameters:
 * - numberType: 'mobile' | 'voip' | 'landline' (default: 'mobile')
 * - reservationType: 'renewable' | 'nonrenewable' | 'verification' (default: 'verification')
 * - withPricing: boolean (default: false) - if true, fetches pricing for each service
 */
export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    const authResult = await requireAuth();
    console.log(`[Panda][Services] ✓ User ${authResult?.user?.email} authenticated`);

    // Parse query parameters
    const numberType = (req.nextUrl.searchParams.get("numberType") as 'mobile' | 'voip' | 'landline') || 'mobile';
    const reservationType = (req.nextUrl.searchParams.get("reservationType") as 'renewable' | 'nonrenewable' | 'verification') || 'verification';
    const withPricing = req.nextUrl.searchParams.get("withPricing") === 'true';
    const areaCode = req.nextUrl.searchParams.get("areaCode") === 'true';
    const carrier = req.nextUrl.searchParams.get("carrier") === 'true';

    console.log(`[Panda][Services] Fetching with params:`, {
      numberType,
      reservationType,
      withPricing,
      areaCode,
      carrier
    });

    const textVerifiedService = new TextVerifiedService();

    let services;
    if (withPricing) {
      // Fetch services with pricing
      services = await textVerifiedService.getServicesWithPricing(numberType, areaCode, carrier);
    } else {
      // Fetch services only
      services = await textVerifiedService.getAvailableServices(numberType, reservationType);
    }

    console.log(`[Panda][Services] ✓ Successfully fetched ${services.length} services`);

    return json({
      ok: true,
      data: {
        services,
        parameters: {
          numberType,
          reservationType,
          withPricing,
          areaCode,
          carrier
        },
        count: services.length
      }
    });

  } catch (e) {
    const err = e as Error;
    console.error("[Panda][Services] Failed to fetch services:", err);
    
    // Handle specific error cases
    if (err.message.includes("API key") || err.message.includes("username")) {
      return error("Panda API credentials not configured", 500);
    }
    
    if (err.message.includes("Bearer token")) {
      return error("Failed to authenticate with Panda API", 500);
    }

    return error(err.message, 500);
  }
}
