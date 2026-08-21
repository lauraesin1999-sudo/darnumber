import { RedisService } from "@/lib/server/services/redis.service";
import { logger } from "@/lib/logger";

const redis = new RedisService();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const API_BASE = "https://www.textverified.com/api/pub/v2";
const USER_AGENT = "DarNumber/1.0";
const TOKEN_CACHE_KEY = "textverified:bearer";

export type TextVerifiedCapability = "sms" | "voice" | "smsAndVoiceCombo";
export type TextVerifiedNumberType = "mobile" | "voip" | "landline";
export type TextVerifiedReservationType =
  | "renewable"
  | "nonrenewable"
  | "verification";

export interface TextVerifiedServiceData {
  serviceName: string;
  description?: string;
  capability: TextVerifiedCapability;
}

interface TextVerifiedPricingRequest {
  serviceName: string;
  areaCode: boolean;
  carrier: boolean;
  numberType: TextVerifiedNumberType;
  capability: TextVerifiedCapability;
}

interface TextVerifiedPricingResponse {
  serviceName: string;
  price: number;
}

export interface TextVerifiedSms {
  id?: string;
  parsedCode?: string | null;
  smsContent?: string | null;
}

const CAPABILITY_ALIASES: Record<string, TextVerifiedCapability> = {
  sms: "sms",
  voice: "voice",
  smsandvoicecombo: "smsAndVoiceCombo",
  smsvoice: "smsAndVoiceCombo",
  combo: "smsAndVoiceCombo",
};

function normalizeCapability(raw: unknown): TextVerifiedCapability | null {
  const key = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return CAPABILITY_ALIASES[key] ?? null;
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.items)) return obj.items;
  if (Array.isArray(obj.services)) return obj.services;
  if (obj.data && typeof obj.data === "object") {
    const nested = obj.data as Record<string, unknown>;
    if (Array.isArray(nested.data)) return nested.data;
    if (Array.isArray(nested.items)) return nested.items;
  }
  return [];
}

function resolveVerificationId(verificationId: string): string {
  if (!verificationId) return verificationId;
  if (verificationId.includes("/")) {
    return verificationId.split("/").filter(Boolean).pop() || verificationId;
  }
  return verificationId;
}

function absoluteUrl(href: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return `https://www.textverified.com${href}`;
  return `${API_BASE}/${href.replace(/^\/+/, "")}`;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  backoff = 300,
): Promise<Response> {
  try {
    const res = await fetch(url, options);
    if (res.status === 429 && retries > 0) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "1", 10);
      logger.warn("[TextVerified] Rate limited, retrying", {
        retryAfter,
        retriesLeft: retries,
        url,
      });
      await delay(Math.max(retryAfter, 1) * 1000);
      return fetchWithRetry(url, options, retries - 1, backoff);
    }
    return res;
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (
      (err.code === "ECONNRESET" ||
        String(err.message || "").includes("fetch failed")) &&
      retries > 0
    ) {
      logger.warn("[TextVerified] Network error, retrying", {
        code: err.code || "FETCH_FAILED",
        backoff,
        retriesLeft: retries,
      });
      await delay(backoff);
      return fetchWithRetry(url, options, retries - 1, backoff * 2);
    }
    throw e;
  }
}

export class TextVerifiedService {
  private apiUrl = API_BASE;
  private apiKey = process.env.TEXTVERIFIED_API_KEY || "";
  private apiUsername = process.env.TEXTVERIFIED_USERNAME || "";
  private bearerToken: string | null = null;
  private tokenExpiry = 0;

  private authHeaders(token: string): HeadersInit {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
  }

  public async getBearerToken(): Promise<string> {
    if (this.bearerToken && Date.now() < this.tokenExpiry) {
      return this.bearerToken;
    }

    try {
      const cached = await redis.getJSON<{ token: string; expiresAt: number }>(
        TOKEN_CACHE_KEY,
      );
      if (cached?.token && cached.expiresAt > Date.now() + 30_000) {
        this.bearerToken = cached.token;
        this.tokenExpiry = cached.expiresAt;
        logger.debug("[TextVerified] Using Redis-cached bearer token");
        return this.bearerToken;
      }
    } catch {
      // Redis unavailable — continue to live auth
    }

    logger.info("[TextVerified] Generating new bearer token");

    if (!this.apiKey || !this.apiUsername) {
      throw new Error("TextVerified API key or username not configured");
    }

    const response = await fetchWithRetry(`${this.apiUrl}/auth`, {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "X-API-USERNAME": this.apiUsername,
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to generate bearer token: ${response.status} - ${errorText}`,
      );
    }

    const data = (await response.json()) as {
      token?: string;
      bearerToken?: string;
      access_token?: string;
      expiresIn?: number;
      expiresAt?: string;
    };
    this.bearerToken = data.token || data.bearerToken || data.access_token || null;

    if (!this.bearerToken) {
      throw new Error("Bearer token not found in response");
    }

    if (data.expiresAt) {
      const parsed = Date.parse(data.expiresAt);
      this.tokenExpiry = Number.isFinite(parsed)
        ? parsed - 60_000
        : Date.now() + 50 * 60 * 1000;
    } else if (typeof data.expiresIn === "number" && data.expiresIn > 0) {
      this.tokenExpiry = Date.now() + Math.max(data.expiresIn - 60, 60) * 1000;
    } else {
      this.tokenExpiry = Date.now() + 50 * 60 * 1000;
    }

    const ttlSeconds = Math.max(
      60,
      Math.floor((this.tokenExpiry - Date.now()) / 1000),
    );
    redis
      .setJSON(
        TOKEN_CACHE_KEY,
        { token: this.bearerToken, expiresAt: this.tokenExpiry },
        ttlSeconds,
      )
      .catch(() => {});

    logger.info("[TextVerified] Bearer token generated", {
      expiresInSeconds: ttlSeconds,
    });
    return this.bearerToken;
  }

  async getAvailableServices(
    numberType: TextVerifiedNumberType = "mobile",
    reservationType: TextVerifiedReservationType = "verification",
  ): Promise<TextVerifiedServiceData[]> {
    const cacheKey = `textverified:services:${numberType}:${reservationType}`;

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as TextVerifiedServiceData[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          logger.info("[TextVerified] Using cached services", {
            numberType,
            reservationType,
            count: parsed.length,
          });
          return parsed;
        }
        logger.warn(
          "[TextVerified] Ignoring empty cached services list — refetching",
          { cacheKey },
        );
      }
    } catch {
      // Redis unavailable — continue to live API
    }

    logger.info("[TextVerified] Fetching services", {
      numberType,
      reservationType,
    });

    try {
      const bearerToken = await this.getBearerToken();
      const params = new URLSearchParams({ numberType, reservationType });
      const url = `${this.apiUrl}/services?${params}`;

      const response = await fetchWithRetry(url, {
        method: "GET",
        headers: this.authHeaders(bearerToken),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("[TextVerified] Services API error", {
          status: response.status,
          body: errorText.slice(0, 500),
        });
        throw new Error(
          `TextVerified API error: ${response.status} - ${errorText}`,
        );
      }

      const data = await response.json();
      const rawServices = extractArray(data);

      const normalizedServices: TextVerifiedServiceData[] = [];
      let dropped = 0;
      for (const item of rawServices) {
        if (!item || typeof item !== "object") {
          dropped++;
          continue;
        }
        const row = item as Record<string, unknown>;
        const serviceName = String(
          row.serviceName || row.service_name || "",
        ).trim();
        const capability = normalizeCapability(row.capability);
        if (!serviceName || !capability) {
          dropped++;
          continue;
        }
        const description =
          typeof row.description === "string" && row.description.trim()
            ? row.description.trim()
            : undefined;
        normalizedServices.push({ serviceName, description, capability });
      }

      logger.info("[TextVerified] Fetched services", {
        count: normalizedServices.length,
        dropped,
        rawCount: rawServices.length,
      });

      if (normalizedServices.length > 0) {
        redis
          .set(cacheKey, JSON.stringify(normalizedServices), 60 * 60)
          .catch(() => {});
      }

      return normalizedServices;
    } catch (error) {
      logger.error("[TextVerified] Failed to fetch services", error);
      throw error;
    }
  }

  async getServicePricing(
    request: TextVerifiedPricingRequest,
  ): Promise<TextVerifiedPricingResponse> {
    const capability = normalizeCapability(request.capability) ?? request.capability;
    const cacheKey = `textverified:pricing:${request.serviceName}:${request.numberType}:${capability}:${request.areaCode}:${request.carrier}`;
    const invalidCacheKey = `textverified:pricing:invalid:${request.serviceName}:${request.numberType}:${capability}`;

    try {
      const isInvalid = await redis.get(invalidCacheKey);
      if (isInvalid) {
        throw new Error(
          `Incompatible service and options: Invalid 'service name' (cached)`,
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("Invalid 'service name'")) {
        throw e;
      }
    }

    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as TextVerifiedPricingResponse;
      }
    } catch {
      // Redis unavailable — continue to live API
    }

    logger.info("[TextVerified] Fetching pricing", {
      serviceName: request.serviceName,
      capability,
      numberType: request.numberType,
    });

    try {
      const bearerToken = await this.getBearerToken();
      const response = await fetchWithRetry(
        `${this.apiUrl}/pricing/verifications`,
        {
          method: "POST",
          headers: this.authHeaders(bearerToken),
          body: JSON.stringify({
            serviceName: request.serviceName,
            areaCode: request.areaCode,
            carrier: request.carrier,
            numberType: request.numberType,
            capability,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 400) {
          redis.set(invalidCacheKey, "1", 2 * 60 * 60).catch(() => {});
          throw new Error(`Incompatible service and options: ${errorText}`);
        }
        logger.error("[TextVerified] Pricing API error", {
          status: response.status,
          serviceName: request.serviceName,
          body: errorText.slice(0, 500),
        });
        throw new Error(
          `TextVerified pricing API error: ${response.status} - ${errorText}`,
        );
      }

      const pricingData = await response.json();
      const serviceName = String(
        pricingData?.serviceName || request.serviceName,
      );
      const price = Number(pricingData?.price);
      if (!Number.isFinite(price)) {
        throw new Error("Invalid pricing response structure");
      }

      const result = { serviceName, price };
      logger.info("[TextVerified] Price fetched", {
        serviceName,
        price,
        capability,
      });
      redis.set(cacheKey, JSON.stringify(result), 30 * 60).catch(() => {});
      return result;
    } catch (error) {
      logger.error("[TextVerified] Failed to fetch pricing", {
        serviceName: request.serviceName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getServicesWithPricing(
    numberType: TextVerifiedNumberType = "mobile",
    areaCode: boolean = false,
    carrier: boolean = false,
    capabilityOverride?: TextVerifiedCapability,
  ): Promise<Array<TextVerifiedServiceData & { price: number }>> {
    const services = await this.getAvailableServices(numberType, "verification");
    const batchSize = 10;
    const servicesWithPricing: Array<TextVerifiedServiceData & { price: number }> =
      [];

    for (let i = 0; i < services.length; i += batchSize) {
      const batch = services.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (service) => {
          try {
            const pricing = await this.getServicePricing({
              serviceName: service.serviceName,
              areaCode,
              carrier,
              numberType,
              capability: capabilityOverride ?? service.capability,
            });
            return { ...service, price: pricing.price };
          } catch (error) {
            logger.warn("[TextVerified] Pricing unavailable for service", {
              serviceName: service.serviceName,
              error: error instanceof Error ? error.message : String(error),
            });
            return { ...service, price: 999999 };
          }
        }),
      );
      servicesWithPricing.push(...batchResults);
      if (i + batchSize < services.length) await delay(100);
    }

    return servicesWithPricing.filter((service) => service.price < 999999);
  }

  private async followVerificationAction(
    payload: Record<string, unknown>,
    bearerToken: string,
  ): Promise<Record<string, unknown>> {
    const href = typeof payload.href === "string" ? payload.href : null;
    const hasIdentity = Boolean(payload.id || payload.number);
    if (!href || hasIdentity) return payload;

    const url = absoluteUrl(href);
    const method = String(payload.method || "GET").toUpperCase();
    logger.info("[TextVerified] Following verification href", { url, method });
    const res = await fetchWithRetry(url, {
      method,
      headers: this.authHeaders(bearerToken),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Failed to load verification details: ${res.status} - ${text}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }

  async requestNumber(
    serviceName: string,
    country: string,
    _orderId?: string,
  ): Promise<{ id: string; phoneNumber: string; cost?: number }> {
    logger.info("[TextVerified] Requesting number", { serviceName, country });

    if (country !== "US") {
      throw new Error("TextVerified only supports the US.");
    }

    const bearerToken = await this.getBearerToken();
    const services = await this.getAvailableServices("mobile", "verification");
    const service = services.find(
      (s) => s.serviceName.toLowerCase() === serviceName.toLowerCase(),
    );

    if (!service) {
      throw new Error(`Service ${serviceName} not found or not available`);
    }

    const preferred: TextVerifiedCapability[] = [
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
      logger.info("[TextVerified] Creating verification", {
        serviceName,
        capability,
      });

      const res = await fetchWithRetry(`${this.apiUrl}/verifications`, {
        method: "POST",
        headers: this.authHeaders(bearerToken),
        body: JSON.stringify({ serviceName: service.serviceName, capability }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        const err = new Error(
          `Failed to request number: ${res.status} - ${errorText}`,
        );
        if (res.status === 400) {
          logger.warn("[TextVerified] Capability unavailable", {
            serviceName,
            capability,
          });
          lastError = err;
          continue;
        }
        throw err;
      }

      const created = (await res.json()) as Record<string, unknown>;
      const details = await this.followVerificationAction(created, bearerToken);
      const id = String(details.id || resolveVerificationId(String(details.href || "")));
      const phoneNumber = String(details.number || details.phoneNumber || "");
      const cost = Number(details.totalCost ?? details.price);

      if (!id) {
        throw new Error("Missing verification id in TextVerified response");
      }

      logger.info("[TextVerified] Verification created", {
        id,
        hasNumber: Boolean(phoneNumber),
        cost: Number.isFinite(cost) ? cost : undefined,
      });

      return {
        id,
        phoneNumber,
        cost: Number.isFinite(cost) ? cost : undefined,
      };
    }

    throw lastError;
  }

  async cancelVerification(verificationId: string): Promise<void> {
    const id = resolveVerificationId(verificationId);
    const bearerToken = await this.getBearerToken();
    const url = `${this.apiUrl}/verifications/${id}/cancel`;

    const res = await fetchWithRetry(url, {
      method: "POST",
      headers: this.authHeaders(bearerToken),
    });

    if (!res.ok) {
      const text = await res.text();
      const lower = text.toLowerCase();
      // Already finished on the provider side — treat as success so refunds can proceed
      if (
        res.status === 400 ||
        res.status === 404 ||
        res.status === 409
      ) {
        if (
          lower.includes("cancel") ||
          lower.includes("timed") ||
          lower.includes("expired") ||
          lower.includes("refund") ||
          lower.includes("complet") ||
          lower.includes("not found") ||
          lower.includes("already")
        ) {
          logger.warn("[TextVerified] Cancel already finalized", {
            id,
            status: res.status,
            body: text.slice(0, 300),
          });
          return;
        }
      }
      throw new Error(`Failed to cancel verification: ${res.status} - ${text}`);
    }

    logger.info("[TextVerified] Cancelled verification", { id });
  }

  async getVerificationDetails(hrefOrId: string): Promise<{
    state?: string;
    number?: string;
    id?: string;
  } | null> {
    const bearerToken = await this.getBearerToken();
    const url =
      hrefOrId.startsWith("http") || hrefOrId.includes("/verifications/")
        ? absoluteUrl(hrefOrId)
        : `${this.apiUrl}/verifications/${resolveVerificationId(hrefOrId)}`;

    const res = await fetchWithRetry(url, {
      method: "GET",
      headers: this.authHeaders(bearerToken),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn("[TextVerified] Failed to fetch verification details", {
        status: res.status,
        body: text.slice(0, 300),
      });
      return null;
    }

    const data = (await res.json()) as Record<string, unknown>;
    const nested = (data.data as Record<string, unknown> | undefined) || undefined;
    return {
      id: String(data.id || nested?.id || resolveVerificationId(hrefOrId)),
      state: String(data.state || nested?.state || ""),
      number: String(
        data.number || nested?.number || nested?.phoneNumber || "",
      ),
    };
  }

  async getSmsForVerification(verificationId: string): Promise<TextVerifiedSms[]> {
    const id = resolveVerificationId(verificationId);
    const bearerToken = await this.getBearerToken();
    const url = `${this.apiUrl}/sms?reservationId=${encodeURIComponent(id)}`;

    const res = await fetchWithRetry(url, {
      method: "GET",
      headers: this.authHeaders(bearerToken),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.warn("[TextVerified] Failed to fetch SMS", {
        id,
        status: res.status,
        body: text.slice(0, 300),
      });
      return [];
    }

    const payload = await res.json();
    return extractArray(payload).map((item) => {
      const row = (item || {}) as Record<string, unknown>;
      return {
        id: typeof row.id === "string" ? row.id : undefined,
        parsedCode:
          (typeof row.parsedCode === "string" && row.parsedCode) ||
          (typeof row.parsed_code === "string" && row.parsed_code) ||
          null,
        smsContent:
          (typeof row.smsContent === "string" && row.smsContent) ||
          (typeof row.sms_content === "string" && row.sms_content) ||
          (typeof row.message === "string" && row.message) ||
          null,
      };
    });
  }

  async invalidateCaches(): Promise<void> {
    try {
      const keys = await redis.keys("textverified:*");
      if (keys.length) await redis.del(...keys);
      logger.info("[TextVerified] Cleared cached services/pricing/token", {
        keys: keys.length,
      });
    } catch (e) {
      logger.warn("[TextVerified] Failed to clear caches", e);
    }
  }
}
