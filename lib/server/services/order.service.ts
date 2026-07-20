import { prisma } from "@/lib/server/prisma";
import { Prisma } from "@/app/generated/prisma";
import { RedisService } from "@/lib/server/services/redis.service";
import { TextVerifiedService } from "./textverified.service";

const redis = new RedisService();

const REFUND_TRANSACTION_OPTIONS = {
  maxWait: 10000,
  timeout: 30000,
} as const;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isExpiredTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2028"
  );
}

/**
 * A robust fetch wrapper that handles retries with exponential backoff for network errors.
 * @param url The URL to fetch.
 * @param options The fetch options.
 * @param retries Number of retries to attempt.
 * @param backoff Initial backoff delay in ms.
 * @returns The fetch Response object.
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

interface CreateOrderInput {
  userId: string;
  serviceCode: string;
  country: string;
  price: number; // Price is now required, fetched on the client for TextVerified
  preferredProvider?: string;
}

export class OrderService {
  async createOrder(input: CreateOrderInput) {
    console.log("[OrderService.createOrder] ========== START ==========");
    console.log("[OrderService.createOrder] Input:", JSON.stringify(input));
    const { userId, serviceCode, country, price, preferredProvider } = input;

    // 1. Validate User
    console.log("[OrderService.createOrder] Step 1: Validating user...");
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true, currency: true },
    });
    if (!user) {
      console.error("[OrderService.createOrder] User not found:", userId);
      throw new Error("User not found");
    }
    console.log(
      "[OrderService.createOrder] User found. Balance:",
      user.balance.toString(),
      user.currency,
    );

    // 2. Validate Provider
    console.log("[OrderService.createOrder] Step 2: Resolving providers for:", {
      serviceCode,
      country,
      preferredProvider,
    });
    const providers = await this.getAvailableProviders(
      serviceCode,
      country,
      preferredProvider,
    );
    console.log(
      "[OrderService.createOrder] Available providers:",
      providers.map((p) => `${p.name} (id: ${p.id})`),
    );
    if (!providers.length) {
      console.error("[OrderService.createOrder] No providers available for:", {
        serviceCode,
        country,
        preferredProvider,
      });
      throw new Error("No providers available for this service and country.");
    }
    const selectedProvider = providers[0];
    console.log(
      "[OrderService.createOrder] Selected provider:",
      selectedProvider,
    );

    // 3. Validate Price and Balance
    console.log(
      "[OrderService.createOrder] Step 3: Validating price and balance...",
    );
    // For TextVerified, the price is passed in. For others, we might calculate it here.
    // This logic assumes the passed 'price' is the final, correct price.
    const finalPrice = new Prisma.Decimal(price);
    console.log(
      "[OrderService.createOrder] Price:",
      finalPrice.toString(),
      "Balance:",
      user.balance.toString(),
    );
    if (user.balance.lt(finalPrice)) {
      console.error("[OrderService.createOrder] Insufficient balance:", {
        balance: user.balance.toString(),
        required: finalPrice.toString(),
        deficit: finalPrice.sub(user.balance).toString(),
      });
      throw new Error("Insufficient balance");
    }
    console.log("[OrderService.createOrder] Balance check passed.");

    // 4. Create Order and Transaction in a single DB operation
    console.log(
      "[OrderService.createOrder] Step 4: Creating order record and deducting balance...",
    );
    const order = await prisma.$transaction(
      async (tx) => {
        // Debit user's balance
        await tx.user.update({
          where: { id: userId },
          data: { balance: { decrement: finalPrice } },
        });

        // Create a transaction record for the payment
        const transaction = await tx.transaction.create({
          data: {
            userId,
            transactionNumber: `TXN-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 9)}`,
            type: "ORDER_PAYMENT",
            amount: finalPrice,
            currency: user.currency,
            balanceBefore: user.balance,
            balanceAfter: user.balance.sub(finalPrice),
            status: "COMPLETED",
            description: `Payment for ${serviceCode} in ${country}`,
          },
        });

        // Create the order record
        const newOrder = await tx.order.create({
          data: {
            userId,
            providerId: selectedProvider.id,
            serviceCode,
            country,
            price: finalPrice,
            finalPrice: finalPrice, // Final price (same as price for now, could be different with discounts)
            transactionId: transaction.id,
            status: "PROCESSING", // Status is now 'PROCESSING'
            expiresAt: new Date(Date.now() + 20 * 60 * 1000), // 20-minute expiry
          },
        });

        return newOrder;
      },
      {
        maxWait: 10000, // Max time to wait for a transaction slot (10s)
        timeout: 15000, // Max transaction execution time (15s)
      },
    );
    console.log("[OrderService.createOrder] Order record created:", {
      orderId: order.id,
      orderNumber: order.orderNumber,
    });

    // 5. Request number with provider failover (outside the main DB transaction)
    console.log(
      "[OrderService.createOrder] Step 5: Requesting number from providers...",
    );
    const providerErrors: Array<{ provider: string; message: string }> = [];

    for (const provider of providers) {
      try {
        console.log(
          `[OrderService.createOrder] Trying provider: ${provider.name} (id: ${provider.id})`,
        );
        const providerService = this.getProviderService(provider.name);
        console.log(
          `[OrderService.createOrder] Requesting number from ${provider.name} for service=${serviceCode} country=${country}...`,
        );

        const providerOrder = await providerService.requestNumber(
          serviceCode,
          country,
          order.id,
        );

        console.log(
          `[OrderService.createOrder] Provider ${provider.name} returned:`,
          {
            id: providerOrder.id,
            phoneNumber: providerOrder.phoneNumber,
            cost: providerOrder.cost,
          },
        );

        const updatedOrder = await prisma.order.update({
          where: { id: order.id },
          data: {
            providerId: provider.id,
            externalId: providerOrder.id,
            phoneNumber: providerOrder.phoneNumber,
            cost: providerOrder.cost
              ? new Prisma.Decimal(providerOrder.cost)
              : undefined,
            status: "WAITING_FOR_SMS",
          },
        });

        console.log("[OrderService.createOrder] ========== SUCCESS ==========");
        console.log("[OrderService.createOrder] Order updated:", {
          orderId: updatedOrder.id,
          phoneNumber: updatedOrder.phoneNumber,
          status: updatedOrder.status,
          expiresAt: updatedOrder.expiresAt,
        });

        return {
          orderId: updatedOrder.id,
          orderNumber: updatedOrder.orderNumber,
          phoneNumber: updatedOrder.phoneNumber,
          status: updatedOrder.status,
          expiresAt: updatedOrder.expiresAt,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        providerErrors.push({ provider: provider.name, message });
        console.warn(
          `[OrderService.createOrder] Provider ${provider.name} failed for order ${order.id}: ${message}`,
        );
        if (e instanceof Error && e.stack) {
          console.warn(`[OrderService.createOrder] Stack trace:`, e.stack);
        }
      }
    }

    console.error(
      `[OrderService] All providers failed for order ${order.id}. Refunding...`,
      providerErrors,
    );
    await this.refundOrder(order.id, "PROVIDER_FAILURE");

    const allUnavailable =
      providerErrors.length > 0 &&
      providerErrors.every((entry) =>
        this.isProviderUnavailableError(entry.message),
      );

    if (allUnavailable) {
      throw new Error(
        "No providers currently have stock for this service. Please try again shortly.",
      );
    }

    throw new Error("Failed to secure a number from the provider.");
  }

  private isProviderUnavailableError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("unavailable") ||
      normalized.includes("out of stock") ||
      normalized.includes("sold out") ||
      normalized.includes("no stock")
    );
  }

  private getProviderService(
    providerName: string,
  ): SMSManService | TextVerifiedService {
    const name = providerName.toLowerCase();
    if (name.includes("lion") || name.includes("sms-man")) {
      return new SMSManService();
    }
    if (name.includes("panda") || name.includes("textverified")) {
      return new TextVerifiedService();
    }
    throw new Error(`Unknown provider: ${providerName}`);
  }

  async getAvailableProviders(
    serviceCode: string,
    country: string,
    preferred?: string,
  ) {
    console.log("[OrderService.getAvailableProviders] Input:", {
      serviceCode,
      country,
      preferred,
    });

    // Normalize preferred provider name to handle various formats
    // Frontend may send "sms-man", "textverified", "lion", "panda", etc.
    const normalizeProvider = (name?: string): string | undefined => {
      if (!name) return undefined;
      const lower = name.toLowerCase();
      if (
        lower.includes("lion") ||
        lower.includes("sms-man") ||
        lower === "sms-man"
      )
        return "sms-man";
      if (
        lower.includes("panda") ||
        lower.includes("textverified") ||
        lower === "textverified"
      )
        return "textverified";
      return lower;
    };

    const normalizedPreferred = normalizeProvider(preferred);
    console.log(
      "[OrderService.getAvailableProviders] Normalized preferred:",
      normalizedPreferred,
    );

    // Use hardcoded providers instead of DB queries
    const availableProviders: Array<{
      id: string;
      name: string;
      priority: number;
    }> = [];

    // Check if SMS-Man (Lion) supports this country
    if (normalizedPreferred === "sms-man" || !normalizedPreferred) {
      // SMS-Man supports all countries globally
      availableProviders.push({
        id: "sms-man",
        name: "sms-man",
        priority: 1,
      });
    }

    // Check if TextVerified (Panda) supports this country
    if (
      country === "US" &&
      (normalizedPreferred === "textverified" || !normalizedPreferred)
    ) {
      availableProviders.push({
        id: "textverified",
        name: "textverified",
        priority: 2,
      });
    }

    // If a preferred provider was specified but not added, return empty
    if (normalizedPreferred && availableProviders.length === 0) {
      console.warn(
        "[OrderService.getAvailableProviders] Preferred provider not available:",
        { preferred, normalizedPreferred, country },
      );
      return [];
    }

    // Sort by priority (higher priority first)
    const sorted = availableProviders.sort((a, b) => b.priority - a.priority);
    console.log(
      "[OrderService.getAvailableProviders] Result:",
      sorted.map((p) => `${p.name} (priority ${p.priority})`),
    );
    return sorted;
  }

  async calculatePricing(
    providerId: string,
    serviceCode: string,
    country: string,
  ) {
    const cacheKey = `pricing:${providerId}:${serviceCode}:${country}`;

    // Cache read is best-effort — failure falls through to DB
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // Redis unavailable — continue to DB
    }

    const providerPrice = await prisma.providerPrice.findFirst({
      where: { providerId, serviceCode, country },
    });
    if (!providerPrice) throw new Error("Pricing not available");

    const pricingRule = await prisma.pricingRule.findFirst({
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

    let profit = 0;
    if (pricingRule) {
      if (pricingRule.profitType === "PERCENTAGE") {
        profit =
          Number(providerPrice.baseCost) *
          (Number(pricingRule.profitValue) / 100);
      } else {
        profit = Number(pricingRule.profitValue);
      }
    }
    const finalPrice = Number(providerPrice.baseCost) + profit;
    const pricing = { baseCost: providerPrice.baseCost, profit, finalPrice };
    // Cache write is fire-and-forget
    redis.set(cacheKey, JSON.stringify(pricing), 300).catch(() => {});
    return pricing;
  }

  async getOrderStatus(orderId: string) {
    console.log("[OrderService] getOrderStatus ->", { orderId });

    // Cache read is best-effort — fall through to DB on Redis failure
    try {
      const cached = await redis.getOrderStatus(orderId);
      if (cached) {
        console.log("[OrderService] cache hit", cached);
        if (cached.status === "WAITING_FOR_SMS" && !cached.smsCode) {
          await this.tryFetchAndUpdateSmsCode(
            orderId,
            cached.provider,
            cached.externalId,
          );
          try {
            const refreshed = await redis.getOrderStatus(orderId);
            if (refreshed) return refreshed;
          } catch {
            // Redis unavailable — fall through to DB fetch below
          }
        } else {
          return cached;
        }
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    let order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        phoneNumber: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        finalPrice: true,
        currency: true,
        serviceCode: true,
        country: true,
        providerId: true,
        externalId: true,
        smsCode: true,
        smsMessage: true,
      },
    });
    if (!order) return null;

    // Opportunistic refresh for TextVerified: if we have an href and no number yet
    try {
      if (
        order.providerId === "textverified" &&
        order.externalId &&
        order.externalId.startsWith("http") &&
        !order.phoneNumber &&
        (order.status === "WAITING_FOR_SMS" || order.status === "PROCESSING")
      ) {
        const tv = new TextVerifiedService();
        const details = await tv.getVerificationDetails(order.externalId);
        if (details && details.number) {
          await prisma.order.update({
            where: { id: order.id },
            data: {
              phoneNumber: details.number,
              status:
                details.state === "verificationCompleted"
                  ? "WAITING_FOR_SMS"
                  : order.status,
            },
          });
          // Update local snapshot
          order.phoneNumber = details.number;
          order.status =
            details.state === "verificationCompleted"
              ? "WAITING_FOR_SMS"
              : order.status;
        }
      }
    } catch (e) {
      console.warn(
        "[OrderService] TextVerified details refresh failed",
        e instanceof Error ? e.message : String(e),
      );
    }

    // If status is WAITING_FOR_SMS and no code, try to fetch code from provider
    if (order.status === "WAITING_FOR_SMS" && !order.smsCode) {
      await this.tryFetchAndUpdateSmsCode(
        order.id,
        order.providerId,
        order.externalId,
      );
      // Re-fetch after possible update
      const refreshed = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          orderNumber: true,
          phoneNumber: true,
          status: true,
          expiresAt: true,
          createdAt: true,
          finalPrice: true,
          currency: true,
          serviceCode: true,
          country: true,
          providerId: true,
          externalId: true,
          smsCode: true,
          smsMessage: true,
        },
      });
      if (refreshed) {
        order = refreshed; // Update order with refreshed data
      }
    }

    // Auto-expire orders that have passed their expiry window
    // The refundOrder method has its own atomic guard to prevent double refunds,
    // so even if two concurrent requests enter this block, only one refund will process.
    if (
      order.expiresAt &&
      new Date(order.expiresAt).getTime() < Date.now() &&
      (order.status === "PENDING" ||
        order.status === "PROCESSING" ||
        order.status === "WAITING_FOR_SMS")
    ) {
      try {
        // Attempt provider cancellation before refund (idempotent, safe if called twice)
        try {
          if (order.externalId) {
            const providerService = this.getProviderService(order.providerId);
            if (providerService instanceof SMSManService) {
              await providerService.cancelNumber(order.externalId);
              await prisma.systemLog.create({
                data: {
                  level: "INFO",
                  service: "order-processor",
                  message: "Auto-expire: provider cancellation (SMS-Man)",
                  metadata: {
                    orderId: order.id,
                    externalId: order.externalId,
                    provider: order.providerId,
                  },
                },
              });
            } else if (providerService instanceof TextVerifiedService) {
              await providerService.cancelVerification(order.externalId);
              await prisma.systemLog.create({
                data: {
                  level: "INFO",
                  service: "order-processor",
                  message: "Auto-expire: provider cancellation (TextVerified)",
                  metadata: {
                    orderId: order.id,
                    externalId: order.externalId,
                    provider: order.providerId,
                  },
                },
              });
            }
          }
        } catch (e) {
          console.error("[OrderService] Provider cancel on expire failed", e);
          await prisma.systemLog.create({
            data: {
              level: "WARN",
              service: "order-processor",
              message: "Auto-expire: provider cancellation failed",
              error: e instanceof Error ? e.message : String(e),
              metadata: {
                orderId: order.id,
                externalId: order.externalId,
                provider: order.providerId,
              },
            },
          });
        }

        await this.refundOrder(order.id, "EXPIRED");
        order.status = "EXPIRED";
      } catch (e) {
        console.error(
          "[OrderService] Failed to auto-expire order",
          order.id,
          e,
        );
      }
    }

    const payload = {
      ...order,
      provider: order.providerId,
    } as any;
    delete (payload as any).providerId;
    // Cache write is fire-and-forget — order status must be readable even if Redis is down
    redis.setOrderStatus(orderId, payload, 300).catch(() => {});
    console.log("[OrderService] getOrderStatus payload", payload);
    return payload;
  }

  /**
   * Try to fetch and update the SMS code for an order from the provider.
   */
  private async tryFetchAndUpdateSmsCode(
    orderId: string,
    providerId: string,
    externalId?: string | null,
  ) {
    if (!externalId) return;
    let code: string | undefined;
    let message: string | undefined;
    let status: string | undefined;
    try {
      if (providerId === "textverified") {
        const tv = new TextVerifiedService();
        // Fetch verification details, look for code
        const detailsUrl = externalId;
        console.log(
          "[tryFetchAndUpdateSmsCode] Fetching TextVerified:",
          detailsUrl,
        );
        // Try fetching messages from /messages endpoint
        const messagesUrl = `${detailsUrl}/messages`;
        console.log(
          "[tryFetchAndUpdateSmsCode] Also trying messages URL:",
          messagesUrl,
        );
        let res = await fetch(messagesUrl, {
          headers: { Authorization: `Bearer ${await tv.getBearerToken()}` },
        });
        if (!res.ok) {
          // Fallback to details URL
          console.log(
            "[tryFetchAndUpdateSmsCode] Messages URL failed, trying details URL",
          );
          res = await fetch(detailsUrl, {
            headers: { Authorization: `Bearer ${await tv.getBearerToken()}` },
          });
        }
        console.log(
          "[tryFetchAndUpdateSmsCode] TextVerified fetch status:",
          res.status,
        );
        if (res.ok) {
          const data = await res.json();
          console.log(
            "[tryFetchAndUpdateSmsCode] TextVerified response:",
            JSON.stringify(data, null, 2),
          );
          // TextVerified: code may be in data.messages[0].parsed_code or message content
          let foundCode = null;
          let foundMessage = null;
          const messages = data?.data?.messages || data?.messages || [];
          if (Array.isArray(messages) && messages.length > 0) {
            for (const msg of messages) {
              if (msg.parsed_code && typeof msg.parsed_code === "string") {
                foundCode = msg.parsed_code;
                foundMessage = msg.message || msg.parsed_code;
                break;
              } else if (
                typeof msg.message === "string" &&
                /\d{3,}/.test(msg.message)
              ) {
                foundCode = (msg.message.match(/\d{3,}/) || [])[0];
                foundMessage = msg.message;
                break;
              }
            }
          }
          if (!foundCode && data?.code && /\d{3,}/.test(data.code)) {
            foundCode = data.code.match(/\d{3,}/)[0];
            foundMessage = data.code;
          }
          if (!foundCode && data?.sms && /\d{3,}/.test(data.sms)) {
            foundCode = data.sms.match(/\d{3,}/)[0];
            foundMessage = data.sms;
          }
          if (!foundCode && data?.data?.code && /\d{3,}/.test(data.data.code)) {
            foundCode = data.data.code.match(/\d{3,}/)[0];
            foundMessage = data.data.code;
          }
          if (!foundCode && data?.data?.sms && /\d{3,}/.test(data.data.sms)) {
            foundCode = data.data.sms.match(/\d{3,}/)[0];
            foundMessage = data.data.sms;
          }
          if (
            !foundCode &&
            data?.parsed_code &&
            /\d{3,}/.test(data.parsed_code)
          ) {
            foundCode = data.parsed_code.match(/\d{3,}/)[0];
            foundMessage = data.parsed_code;
          }
          if (foundCode) {
            code = foundCode;
            message = foundMessage;
            status = "COMPLETED";
            console.log(
              "[tryFetchAndUpdateSmsCode] Found code in TextVerified:",
              code,
            );
          } else {
            console.log(
              "[tryFetchAndUpdateSmsCode] No code found in TextVerified response",
            );
          }
        } else {
          console.log(
            "[tryFetchAndUpdateSmsCode] TextVerified fetch failed:",
            res.status,
            await res.text(),
          );
        }
      } else if (providerId === "sms-man") {
        // SMSMan: poll for code
        const apiKey = process.env.SMSMAN_API_KEY;
        if (!apiKey) {
          console.log("[tryFetchAndUpdateSmsCode] No SMSMAN_API_KEY");
          return;
        }
        // externalId is request_id
        const url = `https://api.sms-man.com/control/get-sms?token=${apiKey}&request_id=${externalId}`;
        console.log(
          "[tryFetchAndUpdateSmsCode] Fetching SMS-Man:",
          url.replace(apiKey, "***"),
        );
        const res = await fetch(url);
        console.log(
          "[tryFetchAndUpdateSmsCode] SMS-Man fetch status:",
          res.status,
        );
        if (res.ok) {
          const data = await res.json();
          console.log(
            "[tryFetchAndUpdateSmsCode] SMS-Man response:",
            JSON.stringify(data, null, 2),
          );
          let foundSms = null;
          if (
            data.sms_code &&
            typeof data.sms_code === "string" &&
            /\d{3,}/.test(data.sms_code)
          ) {
            foundSms = data.sms_code;
          } else if (
            data.sms &&
            typeof data.sms === "string" &&
            /\d{3,}/.test(data.sms)
          ) {
            foundSms = data.sms;
          } else if (
            data.message &&
            typeof data.message === "string" &&
            /\d{3,}/.test(data.message)
          ) {
            foundSms = data.message;
          } else if (
            data.code &&
            typeof data.code === "string" &&
            /\d{3,}/.test(data.code)
          ) {
            foundSms = data.code;
          }
          if (foundSms) {
            code = (foundSms.match(/\d{3,}/) || [])[0];
            message = foundSms;
            status = "COMPLETED";
            console.log(
              "[tryFetchAndUpdateSmsCode] Found code in SMS-Man:",
              code,
            );
          } else {
            console.log(
              "[tryFetchAndUpdateSmsCode] No code found in SMS-Man response",
            );
          }
        } else {
          console.log(
            "[tryFetchAndUpdateSmsCode] SMS-Man fetch failed:",
            res.status,
            await res.text(),
          );
        }
      }
      if (code && status) {
        await prisma.order.update({
          where: { id: orderId },
          data: { smsCode: code, smsMessage: message, status: status as any },
        });
        // Also update cache
        const updated = await prisma.order.findUnique({
          where: { id: orderId },
          select: {
            id: true,
            orderNumber: true,
            phoneNumber: true,
            status: true,
            expiresAt: true,
            createdAt: true,
            finalPrice: true,
            currency: true,
            serviceCode: true,
            country: true,
            providerId: true,
            externalId: true,
            smsCode: true,
            smsMessage: true,
          },
        });
        if (updated) {
          const payload = { ...updated, provider: updated.providerId };
          delete (payload as any).providerId;
          // Fire-and-forget — the DB is the source of truth
          redis.setOrderStatus(orderId, payload, 300).catch(() => {});
        }
      }
    } catch (e) {
      console.warn(`[OrderService] tryFetchAndUpdateSmsCode failed`, e);
    }
  }

  async refundOrder(
    orderId: string,
    reason: "USER_CANCELLED" | "PROVIDER_FAILURE" | "EXPIRED",
  ) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              userId: true,
              price: true,
              status: true,
              user: { select: { balance: true } },
            },
          });

          if (!order) {
            console.error(`[Refund] Order ${orderId} not found.`);
            return;
          }

          // Only refund if the order is in a refundable state
          if (
            order.status === "REFUNDED" ||
            order.status === "COMPLETED" ||
            order.status === "CANCELLED" ||
            order.status === "FAILED" ||
            order.status === "EXPIRED"
          ) {
            console.warn(
              `[Refund] Order ${orderId} is already in a final state (${order.status}). No refund will be processed.`,
            );
            return;
          }

          // Update order status based on reason
          let newStatus: "REFUNDED" | "CANCELLED" | "FAILED" | "EXPIRED" =
            "REFUNDED";
          if (reason === "USER_CANCELLED") newStatus = "CANCELLED";
          if (reason === "PROVIDER_FAILURE") newStatus = "FAILED";
          if (reason === "EXPIRED") newStatus = "EXPIRED";

          // Atomic update: only update if order is still in a refundable state
          // This prevents race conditions where two concurrent refund attempts
          // both pass the status check above before either commits.
          const updated = await tx.order.updateMany({
            where: {
              id: orderId,
              status: {
                notIn: [
                  "REFUNDED",
                  "COMPLETED",
                  "CANCELLED",
                  "FAILED",
                  "EXPIRED",
                ],
              },
            },
            data: { status: newStatus },
          });

          // If no rows were updated, another refund already went through
          if (updated.count === 0) {
            console.warn(
              `[Refund] Order ${orderId} was already processed by a concurrent refund. Aborting.`,
            );
            return;
          }

          // Refund the money
          const newBalance = order.user.balance.add(order.price);
          await tx.user.update({
            where: { id: order.userId },
            data: { balance: { increment: order.price } },
          });

          // Create a refund transaction
          await tx.transaction.create({
            data: {
              userId: order.userId,
              orderId: order.id,
              transactionNumber: `REF-${Date.now()}-${order.id.slice(0, 4)}`,
              type: "REFUND",
              amount: order.price,
              currency: "NGN", // Align with system default and order currency
              balanceBefore: order.user.balance,
              balanceAfter: newBalance,
              status: "COMPLETED",
              description: `Refund for order ${order.id} due to ${reason}`,
            },
          });

          console.log(
            `[Refund] Successfully processed refund for order ${orderId}.`,
          );
        }, REFUND_TRANSACTION_OPTIONS);
      } catch (error) {
        if (!isExpiredTransactionError(error) || attempt === 2) {
          throw error;
        }

        console.warn(
          `[Refund] Transaction expired for order ${orderId}; retrying once...`,
        );
        await delay(250 * attempt);
      }
    }
  }

  async cancelOrder(orderId: string, userId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId, userId },
    });
    if (!order) throw new Error("Order not found");

    if (
      order.status !== "PENDING" &&
      order.status !== "PROCESSING" &&
      order.status !== "WAITING_FOR_SMS"
    ) {
      throw new Error(`Order is in a non-cancellable state: ${order.status}`);
    }

    // Cancel the number with the provider if we have externalId
    try {
      if (order.externalId) {
        const providerService = this.getProviderService(order.providerId);
        if (providerService instanceof SMSManService) {
          await providerService.cancelNumber(order.externalId);
          await prisma.systemLog.create({
            data: {
              level: "INFO",
              service: "order-processor",
              message: "Provider cancellation executed (SMS-Man)",
              metadata: {
                orderId: order.id,
                externalId: order.externalId,
                provider: order.providerId,
                reason: "USER_CANCELLED",
              },
            },
          });
        } else if (providerService instanceof TextVerifiedService) {
          await providerService.cancelVerification(order.externalId);
          await prisma.systemLog.create({
            data: {
              level: "INFO",
              service: "order-processor",
              message: "Provider cancellation executed (TextVerified)",
              metadata: {
                orderId: order.id,
                externalId: order.externalId,
                provider: order.providerId,
                reason: "USER_CANCELLED",
              },
            },
          });
        }
      }
    } catch (e) {
      console.error("[OrderService] Provider cancel failed:", e);
      await prisma.systemLog.create({
        data: {
          level: "WARN",
          service: "order-processor",
          message: "Provider cancellation failed",
          error: e instanceof Error ? e.message : String(e),
          metadata: {
            orderId: order.id,
            externalId: order.externalId,
            provider: order.providerId,
            reason: "USER_CANCELLED",
          },
        },
      });
    }

    await this.refundOrder(orderId, "USER_CANCELLED");

    return { ok: true, message: "Order cancelled and refunded." };
  }
}

// SMS-Man API v2.0 Integration - Simplified and Optimized
export class SMSManService {
  private apiUrl = "https://api.sms-man.com/control";
  private apiKey = process.env.SMSMAN_API_KEY || "";

  async getAvailableServices() {
    console.log("[SMSManService] Starting optimized service fetch...");

    try {
      if (!this.apiKey) {
        throw new Error("SMS-Man API key not configured");
      }

      // Fetch all data in parallel for better performance
      const [countriesRes, applicationsRes, pricesRes] = await Promise.all([
        fetch(`${this.apiUrl}/countries?token=${this.apiKey}`),
        fetch(`${this.apiUrl}/applications?token=${this.apiKey}`),
        fetch(`${this.apiUrl}/get-prices?token=${this.apiKey}`),
      ]);

      if (!countriesRes.ok || !applicationsRes.ok || !pricesRes.ok) {
        throw new Error("Failed to fetch data from SMS-Man API");
      }

      const [countriesData, applicationsData, pricesData] = await Promise.all([
        countriesRes.json(),
        applicationsRes.json(),
        pricesRes.json(),
      ]);

      // Convert API objects to arrays - SMS-Man returns {id: {data}} format
      const countries = Object.values(countriesData);
      const applications = Object.values(applicationsData);

      console.log(
        `[SMSManService] Loaded ${countries.length} countries, ${applications.length} applications`,
      );

      // Create lookup maps for fast processing
      const countriesMap = new Map();
      const applicationsMap = new Map();

      countries.forEach((c: any) => {
        countriesMap.set(c.id.toString(), {
          title: c.title,
          code: c.code,
        });
      });

      applications.forEach((a: any) => {
        applicationsMap.set(a.id, {
          name: a.title || a.name,
          code: a.code,
        });
      });

      // Process pricing data efficiently
      const services: any[] = [];

      Object.entries(pricesData).forEach(
        ([countryId, countryServices]: any) => {
          const country = countriesMap.get(countryId);
          if (!country || typeof countryServices !== "object") return;

          Object.entries(countryServices).forEach(
            ([applicationId, serviceData]: any) => {
              if (!serviceData?.count || serviceData.count <= 0) return;

              const application = applicationsMap.get(applicationId);
              if (!application) return;

              // SMS-Man prices are in Russian Rubles (RUB)
              // Return raw RUB price - conversion RUB→USD→NGN happens in frontend
              const priceRUB = parseFloat(serviceData.cost);

              services.push({
                code: application.code || `app_${applicationId}`,
                name: application.name,
                country: country.code,
                countryName: country.title,
                price: priceRUB, // Raw RUB price
                count: serviceData.count,
                providerId: "sms-man",
                currency: "RUB",
              });
            },
          );
        },
      );

      console.log(
        `[SMSManService] Successfully processed ${services.length} services`,
      );
      return services;
    } catch (err) {
      console.error("[SMSManService] Error:", err);
      throw new Error(
        `SMS-Man API failed: ${
          err instanceof Error ? err.message : "Unknown error"
        }`,
      );
    }
  }

  async cancelNumber(externalId: string): Promise<void> {
    if (!this.apiKey) throw new Error("SMS-Man API key not configured");
    const url = `${this.apiUrl}/cancel-request?token=${this.apiKey}&request_id=${externalId}`;
    const res = await fetch(url, { method: "GET" });

    // Check if response is JSON before parsing
    const contentType = res.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      // If the request is already closed/expired, SMS-Man may return HTML error page
      if (!res.ok) {
        console.warn(
          `[SMSManService] Cancel request ${externalId} failed with status ${res.status} (likely already closed)`,
        );
        return; // Don't throw - order likely already expired on provider side
      }
    }

    const data = await res.json();
    if (data.success === false) {
      // If error is "wrong_status" or similar, it's likely already closed
      if (
        data.error_code === "wrong_status" ||
        data.error_msg?.includes("already closed")
      ) {
        console.warn(
          `[SMSManService] Request ${externalId} already closed: ${data.error_msg}`,
        );
        return; // Don't throw - this is expected for expired orders
      }
      throw new Error(data.error_msg || "Failed to cancel SMS-Man request");
    }
    console.log(`[SMSManService] Cancelled request ${externalId}`);
  }

  async requestNumber(
    serviceCode: string,
    country: string,
    orderId: string,
  ): Promise<{ id: string; phoneNumber: string; cost?: number }> {
    console.log("[SMSManService.requestNumber] ========== START ==========");
    console.log("[SMSManService.requestNumber] Input:", {
      serviceCode,
      country,
      orderId,
    });

    if (!this.apiKey) {
      console.error("[SMSManService.requestNumber] API key not configured!");
      throw new Error("SMS-Man API key not configured");
    }

    // This needs to be reversed; we get a service code like 'wa' and need the ID
    console.log(
      "[SMSManService.requestNumber] Looking up application ID for service code:",
      serviceCode,
    );
    const applications = await this.getApplications();
    const app = applications.find((a) => a.code === serviceCode);
    if (!app) {
      console.error(
        "[SMSManService.requestNumber] Service code not found in applications:",
        {
          serviceCode,
          availableCodes: applications.slice(0, 20).map((a) => a.code),
        },
      );
      throw new Error(`SMS-Man does not support service code: ${serviceCode}`);
    }
    const applicationId = app.id;
    console.log("[SMSManService.requestNumber] Found application:", {
      code: serviceCode,
      id: applicationId,
    });

    console.log(
      "[SMSManService.requestNumber] Looking up country ID for:",
      country,
    );
    const countryId = await this.getCountryIdFromCode(country);
    console.log("[SMSManService.requestNumber] Country ID:", countryId);

    const url = `${this.apiUrl}/get-number?token=${this.apiKey}&country_id=${countryId}&application_id=${applicationId}`;
    console.log(
      "[SMSManService.requestNumber] GET",
      url.replace(this.apiKey, "***"),
    );

    const res = await fetch(url);
    const data = await res.json();
    console.log(
      "[SMSManService.requestNumber] Response:",
      JSON.stringify(data),
    );

    if (data.success === false || data.error_code) {
      console.error("[SMSManService.requestNumber] Provider error:", data);
      throw new Error(data.error_msg || data.error || "Failed to get number");
    }

    console.log("[SMSManService.requestNumber] ========== SUCCESS ==========");
    console.log("[SMSManService.requestNumber] Got number:", {
      request_id: data.request_id,
      number: data.number,
      country_id: data.country_id,
      application_id: data.application_id,
    });

    return {
      id: data.request_id.toString(),
      phoneNumber: data.number,
      cost: data.cost,
    };
  }

  private async getApplications(): Promise<{ id: string; code: string }[]> {
    const cacheKey = "smsman:applications";

    // Cache read is best-effort — fall through to live API on failure
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      // Redis unavailable — continue to live API
    }

    const res = await fetch(`${this.apiUrl}/applications?token=${this.apiKey}`);
    const data = await res.json();
    const applications = Object.values(data).map((a: any) => ({
      id: a.id,
      code: a.slug || a.code,
    }));

    // Cache write is fire-and-forget
    redis.set(cacheKey, JSON.stringify(applications), 60 * 60 * 24).catch(() => {});
    return applications;
  }

  /**
   * Fetches and caches countries from SMS-Man API
   * Returns a map of ISO country code -> SMS-Man country ID
   */
  private async getCountries(): Promise<Map<string, string>> {
    const cacheKey = "smsman:countries";

    // Cache read is best-effort — fall through to live API on failure
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return new Map(Object.entries(JSON.parse(cached)));
      }
    } catch {
      // Redis unavailable — continue to live API
    }

    console.log("[SMSManService] Fetching countries from API...");
    const res = await fetch(`${this.apiUrl}/countries?token=${this.apiKey}`);

    if (!res.ok) {
      throw new Error(`Failed to fetch countries: ${res.status}`);
    }

    const data = await res.json();

    const countryMap = new Map<string, string>();
    Object.entries(data).forEach(([id, country]: [string, any]) => {
      if (country.code) {
        const isoCode = country.code.toUpperCase();
        countryMap.set(isoCode, id);
      }
    });

    console.log(`[SMSManService] Cached ${countryMap.size} countries from API`);

    // Cache write is fire-and-forget
    redis
      .set(cacheKey, JSON.stringify(Object.fromEntries(countryMap)), 60 * 60 * 24)
      .catch(() => {});

    return countryMap;
  }

  /**
   * Converts ISO country code to SMS-Man country ID using API data
   */
  private async getCountryIdFromCode(countryCode: string): Promise<string> {
    const countries = await this.getCountries();
    const countryId = countries.get(countryCode.toUpperCase());

    if (!countryId) {
      console.warn(
        `[SMSManService] Country code "${countryCode}" not found in SMS-Man. Available: ${Array.from(
          countries.keys(),
        )
          .slice(0, 10)
          .join(", ")}...`,
      );
      throw new Error(`Country "${countryCode}" is not supported by SMS-Man`);
    }

    return countryId;
  }
}
