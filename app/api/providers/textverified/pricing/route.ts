import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { TextVerifiedService } from "@/lib/server/services/textverified.service";
import { requireAuth } from "@/lib/server/auth";

export const runtime = "nodejs";

/**
 * POST /api/providers/textverified/pricing
 * Fetches pricing for a specific TextVerified service
 * Request body:
 * {
 *   serviceName: string,
 *   areaCode: boolean,
 *   carrier: boolean,
 *   numberType: 'mobile' | 'voip' | 'landline',
 *   capability: 'sms' | 'voice' | 'smsAndVoiceCombo'
 * }
 */
export async function POST(req: NextRequest) {
  try {
    // Authenticate user
    const authResult = await requireAuth();
    console.log(`[panda][Pricing] ✓ User ${authResult?.user?.email} authenticated`);

    const body = await req.json();

    // Validate required fields
    const { serviceName, areaCode, carrier, numberType, capability } = body;
    
    if (!serviceName || typeof serviceName !== 'string') {
      return error("serviceName is required and must be a string", 400);
    }
    
    if (typeof areaCode !== 'boolean') {
      return error("areaCode is required and must be a boolean", 400);
    }
    
    if (typeof carrier !== 'boolean') {
      return error("carrier is required and must be a boolean", 400);
    }
    
    if (!['mobile', 'voip', 'landline'].includes(numberType)) {
      return error("numberType must be one of: mobile, voip, landline", 400);
    }
    
    if (!['sms', 'voice', 'smsAndVoiceCombo'].includes(capability)) {
      return error("capability must be one of: sms, voice, smsAndVoiceCombo", 400);
    }

    console.log(`[panda][Pricing] Fetching pricing for:`, {
      serviceName,
      areaCode,
      carrier,
      numberType,
      capability
    });

    const textVerifiedService = new TextVerifiedService();
    
    const pricing = await textVerifiedService.getServicePricing({
      serviceName,
      areaCode,
      carrier,
      numberType,
      capability
    });

    console.log(`[panda][Pricing] ✓ Price for ${pricing.serviceName}: $${pricing.price}`);

    return json({
      ok: true,
      data: {
        serviceName: pricing.serviceName,
        price: pricing.price,
        currency: 'USD',
        parameters: {
          areaCode,
          carrier,
          numberType,
          capability
        }
      }
    });

  } catch (e) {
    const err = e as Error;
    console.error("[panda][Pricing] Failed to fetch pricing:", err);
    
    // Handle specific error cases
    if (err.message.includes("API key") || err.message.includes("username")) {
      return error("Panda API credentials not configured", 500);
    }
    
    if (err.message.includes("Bearer token")) {
      return error("Failed to authenticate with Panda API", 500);
    }
    
    if (err.message.includes("Incompatible service and options")) {
      return error(err.message, 400);
    }

    return error(err.message, 500);
  }
}
