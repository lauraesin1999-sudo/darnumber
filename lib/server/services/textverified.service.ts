import { RedisService } from "@/lib/server/services/redis.service";

const redis = new RedisService();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A robust fetch wrapper that handles retries with exponential backoff for network errors.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  backoff = 300,
): Promise<Response> {
  try {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "1");
      console.warn(
        `[fetchWithRetry] Rate limited. Retrying after ${retryAfter}s...`,
      );
      await delay(retryAfter * 1000);
      return fetchWithRetry(url, options, retries - 1, backoff);
    }
    return res;
  } catch (e: any) {
    if (
      (e.code === "ECONNRESET" || e.message.includes("fetch failed")) &&
      retries > 0
    ) {
      console.warn(
        `[fetchWithRetry] Network error (${
          e.code || "FETCH_FAILED"
        }). Retrying in ${backoff}ms... (${retries} retries left)`,
      );
      await delay(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw e;
  }
}

// TextVerified API interfaces
interface TextVerifiedServiceData {
  serviceName: string;
  capability: "sms" | "voice" | "smsAndVoiceCombo";
}

interface TextVerifiedPricingRequest {
  serviceName: string;
  areaCode: boolean;
  carrier: boolean;
  numberType: "mobile" | "voip" | "landline";
  capability: "sms" | "voice" | "smsAndVoiceCombo";
}

interface TextVerifiedPricingResponse {
  serviceName: string;
  price: number;
}

export class TextVerifiedService {
  private apiUrl = "https://www.textverified.com/api/pub/v2";
  private apiKey = process.env.TEXTVERIFIED_API_KEY || "";
  private apiUsername = process.env.TEXTVERIFIED_USERNAME || "";
  private bearerToken: string | null = null;
  private tokenExpiry: number = 0;

  /**
   * Generate bearer token using X-API-KEY and X-API-USERNAME
   */
  public async getBearerToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.bearerToken && Date.now() < this.tokenExpiry) {
      console.log("[TextVerified] Using cached bearer token");
      return this.bearerToken; // TypeScript: this.bearerToken is string due to truthy check
    }

    console.log("[TextVerified] Generating new bearer token...");

    if (!this.apiKey || !this.apiUsername) {
      throw new Error("TextVerified API key or username not configured");
    }

    const authUrl = `${this.apiUrl}/auth`;
    const response = await fetchWithRetry(authUrl, {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "X-API-USERNAME": this.apiUsername,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to generate bearer token: ${response.status} - ${errorText}`,
      );
    }

    const data = await response.json();
    this.bearerToken = data.token || data.bearerToken || data.access_token;

    if (!this.bearerToken) {
      throw new Error("Bearer token not found in response");
    }

    // Cache token for 50 minutes (assuming 60min expiry)
    this.tokenExpiry = Date.now() + 50 * 60 * 1000;
    console.log("[TextVerified] ✓ Bearer token generated successfully");

    return this.bearerToken;
  }

  /**
   * Fetch available services from TextVerified API
   * Uses /api/pub/v2/services endpoint with proper parameters
   */
  async getAvailableServices(
    numberType: "mobile" | "voip" | "landline" = "mobile",
    reservationType:
      | "renewable"
      | "nonrenewable"
      | "verification" = "verification",
  ): Promise<TextVerifiedServiceData[]> {
    const cacheKey = `textverified:services:${numberType}:${reservationType}`;

    // Cache read is best-effort — fall through to live API on Redis failure
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(
          `[TextVerified] Using cached services for ${numberType}/${reservationType}`,
        );
        return JSON.parse(cached);
      }
    } catch {
      // Redis unavailable — continue to live API
    }

    console.log(
      `[TextVerified] Fetching services for ${numberType}/${reservationType}...`,
    );

    try {
      const bearerToken = await this.getBearerToken();

      // Build URL with query parameters
      const params = new URLSearchParams({
        numberType,
        reservationType,
      });

      const url = `${this.apiUrl}/services?${params}`;
      console.log(`[TextVerified] Requesting: ${url}`);

      const response = await fetchWithRetry(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
      });

      console.log(
        `[TextVerified] Services response: ${response.status} ${response.statusText}`,
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[TextVerified] API Error: ${response.status} - ${errorText}`,
        );
        throw new Error(
          `TextVerified API error: ${response.status} - ${errorText}`,
        );
      }

      const data = await response.json();

      // Extract services array from response
      let services: TextVerifiedServiceData[] = [];
      if (Array.isArray(data)) {
        services = data;
      } else if (Array.isArray(data?.data)) {
        services = data.data;
      } else if (Array.isArray(data?.items)) {
        services = data.items;
      } else if (Array.isArray(data?.services)) {
        services = data.services;
      }

      console.log(`[TextVerified] ✓ Fetched ${services.length} services`);

      // Validate service structure
      const validatedServices = services.filter(
        (service) =>
          service &&
          typeof service.serviceName === "string" &&
          [
            "sms",
            "voice",
            "smsAndVoiceCombo",
            "Voice",
            "SMS",
            "VOICE",
          ].includes(service.capability),
      );

      if (validatedServices.length !== services.length) {
        console.warn(
          `[TextVerified] Filtered ${services.length - validatedServices.length} invalid services`,
        );
      }

      // Normalize capability values to lowercase for consistency
      const normalizedServices = validatedServices.map((service) => ({
        ...service,
        capability: service.capability.toLowerCase() as
          | "sms"
          | "voice"
          | "smsAndVoiceCombo",
      }));

      // Cache write is fire-and-forget
      redis.set(cacheKey, JSON.stringify(normalizedServices), 60 * 60).catch(() => {});

      return normalizedServices;
    } catch (error) {
      console.error(`[TextVerified] Failed to fetch services:`, error);
      console.error(`[TextVerified] Error details:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: error instanceof Error ? error.name : undefined,
      });
      throw error;
    }
  }

  /**
   * Fetch pricing for a specific service and options
   * Uses /api/pub/v2/pricing/verifications endpoint
   */
  async getServicePricing(
    request: TextVerifiedPricingRequest,
  ): Promise<TextVerifiedPricingResponse> {
    const cacheKey = `textverified:pricing:${request.serviceName}:${request.numberType}:${request.capability}:${request.areaCode}:${request.carrier}`;
    const invalidCacheKey = `textverified:pricing:invalid:${request.serviceName}`;

    // Negative cache — best-effort: if Redis is down we simply re-hit the API
    try {
      const isInvalid = await redis.get(invalidCacheKey);
      if (isInvalid) {
        console.log(
          `[TextVerified] Skipping invalid service (cached): ${request.serviceName}`,
        );
        throw new Error(
          `Incompatible service and options: Invalid 'service name' (cached)`,
        );
      }
    } catch (e) {
      // Re-throw only if it's our own intentional throw above
      if (e instanceof Error && e.message.includes("Invalid 'service name'")) throw e;
      // Otherwise Redis failed — continue to API
    }

    // Pricing cache — best-effort
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log(
          `[TextVerified] Using cached pricing for ${request.serviceName}`,
        );
        return JSON.parse(cached);
      }
    } catch {
      // Redis unavailable — continue to live API
    }

    console.log(
      `[TextVerified] Fetching pricing for ${request.serviceName}...`,
    );

    try {
      const bearerToken = await this.getBearerToken();

      const url = `${this.apiUrl}/pricing/verifications`;
      console.log(`[TextVerified] Requesting pricing: ${url}`);

      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      console.log(
        `[TextVerified] Pricing response: ${response.status} ${response.statusText}`,
      );

      if (!response.ok) {
        const errorText = await response.text();

        // Handle 400 Bad Request for incompatible service/option combinations
        // Cache the failure for 2 hours so we skip repeated API calls for the same invalid name
        if (response.status === 400) {
          // Fire-and-forget negative cache
          redis.set(invalidCacheKey, "1", 2 * 60 * 60).catch(() => {});
          throw new Error(`Incompatible service and options: ${errorText}`);
        }

        console.error(
          `[TextVerified] Pricing API Error: ${response.status} - ${errorText}`,
        );
        throw new Error(
          `TextVerified pricing API error: ${response.status} - ${errorText}`,
        );
      }

      const pricingData = await response.json();

      // Validate response structure
      if (
        !pricingData ||
        typeof pricingData.serviceName !== "string" ||
        typeof pricingData.price !== "number"
      ) {
        throw new Error("Invalid pricing response structure");
      }

      console.log(
        `[TextVerified] ✓ Price for ${pricingData.serviceName}: $${pricingData.price}`,
      );

      // Cache write is fire-and-forget
      redis.set(cacheKey, JSON.stringify(pricingData), 30 * 60).catch(() => {});

      return pricingData;
    } catch (error) {
      console.error(
        `[TextVerified] Failed to fetch pricing for ${request.serviceName}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get all available services with their pricing
   * Combines services and pricing endpoints for complete data
   */
  async getServicesWithPricing(
    numberType: "mobile" | "voip" | "landline" = "mobile",
    areaCode: boolean = false,
    carrier: boolean = false,
    capabilityOverride?: "sms" | "voice" | "smsAndVoiceCombo",
  ): Promise<Array<TextVerifiedServiceData & { price: number }>> {
    const capabilityLabel = capabilityOverride ?? "(per-service)";
    console.log(
      `[TextVerified] Fetching services with pricing (capability: ${capabilityLabel})...`,
    );

    // Get all available services
    const services = await this.getAvailableServices(
      numberType,
      "verification",
    );

    // Fetch pricing for each service in parallel batches
    const batchSize = 10;
    const servicesWithPricing: Array<
      TextVerifiedServiceData & { price: number }
    > = [];

    for (let i = 0; i < services.length; i += batchSize) {
      const batch = services.slice(i, i + batchSize);

      const pricingPromises = batch.map(async (service) => {
        try {
          const pricing = await this.getServicePricing({
            serviceName: service.serviceName,
            areaCode,
            carrier,
            numberType,
            capability: capabilityOverride ?? service.capability,
          });

          return {
            ...service,
            price: pricing.price,
          };
        } catch (error) {
          console.warn(
            `[TextVerified] Failed to get pricing for ${service.serviceName}:`,
            error,
          );
          // Return service with default high price to indicate unavailable
          return {
            ...service,
            price: 999999, // High price to indicate unavailable
          };
        }
      });

      const batchResults = await Promise.all(pricingPromises);
      servicesWithPricing.push(...batchResults);

      // Small delay between batches to avoid rate limiting
      if (i + batchSize < services.length) {
        await delay(100);
      }
    }

    // Filter out services with unavailable pricing
    const availableServices = servicesWithPricing.filter(
      (service) => service.price < 999999,
    );

    console.log(
      `[TextVerified] ✓ ${availableServices.length} services with pricing available`,
    );

    return availableServices;
  }

  /**
   * Request a verification number
   */
  async requestNumber(
    serviceName: string,
    country: string,
  ): Promise<{ id: string; phoneNumber: string; cost?: number }> {
    console.log(
      `[TextVerified] Requesting number for ${serviceName} in ${country}`,
    );

    if (country !== "US") {
      throw new Error("TextVerified only supports the US.");
    }

    const bearerToken = await this.getBearerToken();

    // Get service capability first
    const services = await this.getAvailableServices("mobile", "verification");
    const service = services.find((s) => s.serviceName === serviceName);

    if (!service) {
      throw new Error(`Service ${serviceName} not found or not available`);
    }

    const verificationUrl = `${this.apiUrl}/verifications`;

    // Try capabilities in preference order.
    // "sms" is attempted first because voice inventory is frequently exhausted.
    // The service's own advertised capability is tried next, then smsAndVoiceCombo.
    // Duplicates are removed so we never POST the same capability twice.
    const preferred: Array<"sms" | "voice" | "smsAndVoiceCombo"> = [
      "sms",
      service.capability,
      "smsAndVoiceCombo",
    ];
    const capabilitiesToTry = preferred.filter(
      (v, i, arr) => arr.indexOf(v) === i,
    );

    let lastError: Error = new Error(
      `Service ${serviceName} is out of stock for all capability types.`,
    );

    for (const capability of capabilitiesToTry) {
      console.log(
        `[TextVerified] Creating verification with capability: ${capability}`,
      );

      const res = await fetchWithRetry(verificationUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ serviceName, capability }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        const err = new Error(
          `Failed to request number: ${res.status} - ${errorText}`,
        );
        // 400 "Unavailable/Out of stock" → try next capability
        if (res.status === 400) {
          console.warn(
            `[TextVerified] capability=${capability} unavailable for ${serviceName}, trying next...`,
          );
          lastError = err;
          continue;
        }
        // Any other error (401, 5xx, etc.) → bail immediately
        throw err;
      }

      const responseData = await res.json();
      const href: string = responseData.href;

      if (!href) {
        throw new Error("Missing verification href in response");
      }

      console.log(`[TextVerified] ✓ Verification created: ${href}`);

      return {
        id: href,
        phoneNumber: responseData.number,
        cost: responseData.price,
      };
    }

    // All capabilities exhausted
    throw lastError;
  }

  /**
   * Cancel a verification
   */
  async cancelVerification(verificationId: string): Promise<void> {
    const id = verificationId.startsWith("http")
      ? verificationId.split("/").pop() || verificationId
      : verificationId;

    const bearerToken = await this.getBearerToken();
    const url = `${this.apiUrl}/verifications/${id}`;

    const res = await fetchWithRetry(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to cancel verification: ${text}`);
    }

    console.log(`[TextVerified] ✓ Cancelled verification ${id}`);
  }

  /**
   * Get verification details
   */
  async getVerificationDetails(href: string): Promise<{
    state?: string;
    number?: string;
  } | null> {
    const bearerToken = await this.getBearerToken();
    const res = await fetchWithRetry(href, {
      method: "GET",
      headers: { Authorization: `Bearer ${bearerToken}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(
        `[TextVerified] Failed to fetch verification details (${res.status}): ${text}`,
      );
      return null;
    }

    const data = await res.json();
    const state = data?.state || data?.data?.state;
    const number =
      data?.data?.phoneNumber || data?.data?.number || data?.number;

    return { state, number };
  }
}
