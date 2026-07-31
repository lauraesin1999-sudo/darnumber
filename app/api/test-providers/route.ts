import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { SMSManService } from "@/lib/server/services/order.service";
import { TextVerifiedService } from "@/lib/server/services/textverified.service";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  console.log("=== GET /api/test-providers START ===");
  try {
    console.log("Testing SMS providers without authentication...");

    // Test SMS-Man
    let smsManServices: any[] = [];
    let smsManError: string | null = null;
    try {
      console.log("Testing SMS-Man API...");
      const smsManService = new SMSManService();
      smsManServices = await smsManService.getAvailableServices();
      console.log("SMS-Man services count:", smsManServices.length);
      console.log("Sample SMS-Man service:", smsManServices[0]);
    } catch (err) {
      smsManError = err instanceof Error ? err.message : "Unknown error";
      console.error("SMS-Man error:", smsManError);
    }

    // Test TextVerified
    let tvServices: any[] = [];
    let tvError: string | null = null;
    try {
      console.log("Testing Panda API...");
      const textVerifiedService = new TextVerifiedService();
      tvServices = await textVerifiedService.getAvailableServices();
      console.log("Panda services count:", tvServices.length);
      console.log("Sample Panda service:", tvServices[0]);
    } catch (err) {
      tvError = err instanceof Error ? err.message : "Unknown error";
      console.error("Panda error:", tvError);
    }

    const result = {
      smsMan: {
        success: smsManError === null,
        error: smsManError,
        servicesCount: smsManServices.length,
        sampleService: smsManServices[0] || null,
      },
      textVerified: {
        success: tvError === null,
        error: tvError,
        servicesCount: tvServices.length,
        sampleService: tvServices[0] || null,
      },
      totalServices: smsManServices.length + tvServices.length,
    };

    console.log("Test result:", result);
    console.log("=== GET /api/test-providers END ===");

    return json({ ok: true, data: result });
  } catch (e) {
    console.error("=== GET /api/test-providers ERROR ===");
    console.error("Error:", e);
    return error("Test failed", 500);
  }
}
