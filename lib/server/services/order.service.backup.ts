import { prisma } from "@/lib/server/prisma";
import { Prisma } from "@/app/generated/prisma";
import { RedisService } from "@/lib/server/services/redis.service";

const redis = new RedisService();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const { userId, serviceCode, country, price, preferredProvider } = input;

    // 1. Validate User
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true, currency: true },
    });
    if (!user) throw new Error("User not found");

    // 2. Validate Provider
    const providers = await this.getAvailableProviders(
      serviceCode,
      country,
      preferredProvider,
    );
    if (!providers.length) {
      throw new Error("No providers available for this service and country.");
    }
    const selectedProvider = providers[0];

    // 3. Validate Price and Balance
    // For TextVerified, the price is passed in. For others, we might calculate it here.
    // This logic assumes the passed 'price' is the final, correct price.
    const finalPrice = new Prisma.Decimal(price);
    if (user.balance.lt(finalPrice)) {
      throw new Error("Insufficient balance");
    }

    // 4. Create Order and Transaction in a single DB operation
    const order = await prisma.$transaction(async (tx) => {
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
    });

    // 5. Request number from the provider (outside the main DB transaction)
    try {
      const providerService = this.getProviderService(selectedProvider.name);
      console.log(
        `[OrderService] Requesting number from ${selectedProvider.name}...`,
      );

      const providerOrder = await providerService.requestNumber(
        serviceCode,
        country,
        order.id, // Pass orderId for logging and context
      );

      // Update order with provider details
      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: {
          externalId: providerOrder.id,
          phoneNumber: providerOrder.phoneNumber,
          cost: providerOrder.cost
            ? new Prisma.Decimal(providerOrder.cost)
            : undefined,
          status: "WAITING_FOR_SMS",
        },
      });

      return {
        orderId: updatedOrder.id,
        phoneNumber: updatedOrder.phoneNumber,
        status: updatedOrder.status,
        expiresAt: updatedOrder.expiresAt,
      };
    } catch (e) {
      console.error(
        `[OrderService] Provider request failed for order ${order.id}. Refunding...`,
        e,
      );
      // If provider fails, refund the order
      await this.refundOrder(order.id, "PROVIDER_FAILURE");
      throw new Error("Failed to secure a number from the provider.");
    }
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
    // Use hardcoded providers instead of DB queries
    const availableProviders: Array<{
      id: string;
      name: string;
      priority: number;
    }> = [];

    // Check if SMS-Man (Lion) supports this country
    if (preferred === "sms-man" || !preferred) {
      // SMS-Man supports all countries globally
      availableProviders.push({
        id: "sms-man",
        name: "sms-man",
        priority: 1,
      });
    }

    // Check if TextVerified (Panda) supports this country
    if (country === "US" && (preferred === "textverified" || !preferred)) {
      availableProviders.push({
        id: "textverified",
        name: "textverified",
        priority: 2,
      });
    }

    // If a preferred provider was specified but not added, return empty
    if (preferred && availableProviders.length === 0) {
      return [];
    }

    // Sort by priority (higher priority first)
    return availableProviders.sort((a, b) => b.priority - a.priority);
  }

  async calculatePricing(
    providerId: string,
    serviceCode: string,
    country: string,
  ) {
    const cacheKey = `pricing:${providerId}:${serviceCode}:${country}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

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
    await redis.set(cacheKey, JSON.stringify(pricing), 300);
    return pricing;
  }

  async getOrderStatus(orderId: string) {
    console.log("[OrderService] getOrderStatus ->", { orderId });

    const cached = await redis.getOrderStatus(orderId);
    if (cached) {
      console.log("[OrderService] cache hit", cached);
      // If status is WAITING_FOR_SMS, try to opportunistically refresh code
      if (cached.status === "WAITING_FOR_SMS" && !cached.smsCode) {
        await this.tryFetchAndUpdateSmsCode(
          orderId,
          cached.provider,
          cached.externalId,
        );
        // Re-fetch after possible update
        const refreshed = await redis.getOrderStatus(orderId);
        if (refreshed) return refreshed;
      }
      return cached;
    }

    const order = await prisma.order.findUnique({
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
        "[OrderService] Panda details refresh failed",
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
        },
      });
      if (refreshed) {
        const payload = { ...refreshed, provider: refreshed.providerId };
        delete (payload as any).providerId;
        await redis.setOrderStatus(orderId, payload, 300);
        console.log("[OrderService] getOrderStatus payload", payload);
        return payload;
      }
    }

    // Auto-expire orders that have passed their expiry window
    if (
      order.expiresAt &&
      new Date(order.expiresAt).getTime() < Date.now() &&
      (order.status === "PENDING" ||
        order.status === "PROCESSING" ||
        order.status === "WAITING_FOR_SMS")
    ) {
      try {
        // Attempt provider cancellation before refund
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
                  message: "Auto-expire: provider cancellation (Panda)",
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
    await redis.setOrderStatus(orderId, payload, 300);
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
          "[tryFetchAndUpdateSmsCode] Fetching Panda:",
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
          "[tryFetchAndUpdateSmsCode] Panda fetch status:",
          res.status,
        );
        if (res.ok) {
          const data = await res.json();
          console.log(
            "[tryFetchAndUpdateSmsCode] Panda response:",
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
              "[tryFetchAndUpdateSmsCode] Found code in Panda:",
              code,
            );
          } else {
            console.log(
              "[tryFetchAndUpdateSmsCode] No code found in Panda response",
            );
          }
        } else {
          console.log(
            "[tryFetchAndUpdateSmsCode] Panda fetch failed:",
            res.status,
            await res.text(),
          );
        }
      } else if (providerId === "sms-man") {
        // SMSMan: poll for code
        const apiKey = process.env.SMSMAN_API_KEY;
        if (!apiKey) {
          console.log("[tryFetchAndUpdateSmsCode] No Lion");
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
          await redis.setOrderStatus(orderId, payload, 300);
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
        order.status === "CANCELLED"
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

      await tx.order.update({
        where: { id: orderId },
        data: { status: newStatus },
      });

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
    });
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
              message: "Provider cancellation executed (Panda)",
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
    const data = await res.json();
    if (data.success === false) {
      throw new Error(data.error_msg || "Failed to cancel SMS-Man request");
    }
    console.log(`[SMSManService] Cancelled request ${externalId}`);
  }

  async requestNumber(
    serviceCode: string,
    country: string,
    orderId: string,
  ): Promise<{ id: string; phoneNumber: string; cost?: number }> {
    console.log("[SMSManService] requestNumber", {
      serviceCode,
      country,
      orderId,
    });

    if (!this.apiKey) {
      throw new Error("SMS-Man API key not configured");
    }

    // This needs to be reversed; we get a service code like 'wa' and need the ID
    const applications = await this.getApplications();
    const app = applications.find((a) => a.code === serviceCode);
    if (!app) {
      throw new Error(`SMS-Man does not support service code: ${serviceCode}`);
    }
    const applicationId = app.id;

    const countryId = this.getCountryIdFromCode(country);

    const url = `${this.apiUrl}/get-number?token=${this.apiKey}&country_id=${countryId}&application_id=${applicationId}`;
    console.log("[SMSManService] GET", url);

    const res = await fetch(url);
    const data = await res.json();
    console.log("[SMSManService] Response", data);

    if (data.success === false || data.error_code) {
      throw new Error(data.error_msg || data.error || "Failed to get number");
    }

    return {
      id: data.request_id.toString(),
      phoneNumber: data.number,
      cost: data.cost, // Assuming the API returns a cost
    };
  }

  private async getApplications(): Promise<{ id: string; code: string }[]> {
    const cacheKey = "smsman:applications";
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const res = await fetch(`${this.apiUrl}/applications?token=${this.apiKey}`);
    const data = await res.json();
    const applications = Object.values(data).map((a: any) => ({
      id: a.id,
      code: a.slug || a.code, // 'slug' is often the code we need
    }));

    await redis.set(cacheKey, JSON.stringify(applications), 60 * 60 * 24); // Cache for 24 hours
    return applications;
  }

  private getCountryIdFromCode(countryCode: string): string {
    // Reverse mapping from ISO code to SMS-Man country ID
    const codeMap: Record<string, string> = {
      RU: "0",
      UA: "1",
      KZ: "2",
      CN: "3",
      PH: "4",
      MM: "5",
      ID: "6",
      MY: "7",
      KE: "8",
      TZ: "9",
      VN: "10",
      KG: "11",
      US: "12",
      IL: "13",
      HK: "14",
      PL: "15",
      GB: "16",
      MG: "17",
      ZA: "18",
      RO: "19",
      EG: "20",
      IN: "21",
      IE: "22",
      KH: "23",
      LA: "24",
      HT: "25",
      CI: "26",
      GM: "27",
      RS: "28",
      YE: "29",
      ZM: "30",
      UZ: "31",
      TJ: "32",
      EC: "33",
      SV: "34",
      LY: "35",
      JM: "36",
      TT: "37",
      GH: "38",
      AR: "39",
      UG: "40",
      ZW: "41",
      BO: "42",
      CM: "43",
      MA: "44",
      AO: "45",
      CA: "46",
      MZ: "47",
      NP: "48",
      KR: "49",
      TH: "50",
      BD: "51",
      NL: "52",
      FR: "53",
      DE: "54",
      IT: "55",
      ES: "56",
      BR: "57",
      MX: "58",
      NG: "59",
    };
    return codeMap[countryCode] || "12"; // Default to US
  }
}

// TextVerified provider adapter - USA only
export class TextVerifiedService {
  private apiUrl = "https://www.textverified.com/api/pub/v2";
  private apiKey = process.env.TEXTVERIFIED_API_KEY || "";
  private apiUsername = process.env.TEXTVERIFIED_USERNAME || "";
  private bearerToken: string | null = null;
  private tokenExpiry: number = 0;
  private servicesCache: any[] | null = null;
  private servicesCacheExpiry: number = 0;

  // Generate bearer token using X-API-KEY and X-API-USERNAME
  public async getBearerToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.bearerToken && Date.now() < this.tokenExpiry) {
      console.log("[Panda] Using cached bearer token");
      return this.bearerToken;
    }

    console.log("[Panda] Generating new bearer token...");

    if (!this.apiKey || !this.apiUsername) {
      throw new Error("Panda API key or username not configured");
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
    console.log("[Panda] ✓ Bearer token generated successfully");

    return this.bearerToken;
  }

  async cancelVerification(verificationId: string): Promise<void> {
    // Support passing full href or just the ID
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
      throw new Error(`Failed to cancel Panda verification: ${text}`);
    }
    console.log(`[Panda] Cancelled verification ${id}`);
  }

  async getAvailableServices() {
    // Check cache first (cache for 1 hour)
    if (this.servicesCache && Date.now() < this.servicesCacheExpiry) {
      console.log("[Panda] Using cached services list");
      return this.servicesCache;
    }

    console.log("\n╔═══════════════════════════════════════════════╗");
    console.log("║ Panda - Fetching ALL Available Services");
    console.log("╚═══════════════════════════════════════════════╝");

    try {
      // Generate bearer token
      const bearerToken = await this.getBearerToken();

      // Fetch services list - using correct endpoint
      const servicesParams = new URLSearchParams({
        numberType: "mobile",
        reservationType: "verification",
      }).toString();
      const servicesUrl = `${this.apiUrl}/services?${servicesParams}`;
      console.log(`[Panda] Fetching services from: ${servicesUrl}`);

      const servicesResponse = await fetchWithRetry(servicesUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
      });

      console.log(
        `[Panda] Services response: ${servicesResponse.status} ${servicesResponse.statusText}`,
      );

      if (!servicesResponse.ok) {
        const errorText = await servicesResponse.text();
        console.error(`[Panda] API Error: ${servicesResponse.status}`);
        console.error(`[Panda] Error body:`, errorText);
        throw new Error(
          `Panda API error: ${servicesResponse.status} - ${errorText}`,
        );
      }

      const servicesData = await servicesResponse.json();
      // Try to extract list from multiple possible shapes
      const extractServices = (data: any) => {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.data)) return data.data;
        if (Array.isArray(data?.items)) return data.items;
        if (Array.isArray(data?.data?.items)) return data.data.items;
        return [];
      };
      const servicesList = extractServices(servicesData);

      console.log(
        `[Panda] Total services found: ${servicesList.length}`,
      );

      if (servicesList.length === 0) {
        console.warn(`[Panda] ⚠️  No services returned from API`);
        console.warn(
          `[Panda] Raw services payload keys: ${Object.keys(
            servicesData || {},
          ).join(", ")}`,
        );
        console.warn(
          `[Panda] Raw:`,
          JSON.stringify(servicesData).slice(0, 1000),
        );
        return [];
      }

      // Log first service to see available fields
      if (servicesList.length > 0) {
        console.log(
          `[Panda] Sample service fields:`,
          JSON.stringify(servicesList[0], null, 2),
        );
      }

      // Return services with pricing data if available
      const services = servicesList.map((service: any) => {
        // Try to extract price from various possible field names
        const price =
          service.price ||
          service.cost ||
          service.minimumCost ||
          service.minCost ||
          service.verificationCost ||
          0;

        return {
          code: service.serviceName || service.name || service.id,
          name: service.serviceName || service.name || `${service.id}`,
          country: "US",
          countryName: "United States",
          price: typeof price === "number" ? price : parseFloat(price) || 0,
          count: 100, // Placeholder
          providerId: "Panda",
          currency: "USD",
          capability: service.capability || "sms",
        };
      });

      // Count services with pricing data
      const servicesWithPrice = services.filter((s: any) => s.price > 0).length;
      console.log(
        `\n[Panda] ✅ Successfully processed ${services.length} services (${servicesWithPrice} with pricing)`,
      );
      console.log("╚═══════════════════════════════════════════════╝\n");

      // Cache services for 1 hour
      this.servicesCache = services;
      this.servicesCacheExpiry = Date.now() + 60 * 60 * 1000;

      return services;
    } catch (err) {
      console.error("\n[Panda] ❌ FATAL ERROR");
      console.error(
        "[Panda] Error:",
        err instanceof Error ? err.message : err,
      );
      if (err instanceof Error) {
        console.error("[Panda] Stack:", err.stack);
      }
      console.log("╚═══════════════════════════════════════════════╝\n");

      return [];
    }
  }

  /**
   * Fetches the price for a single service by its name and caches it in Redis.
   * @param serviceName The name of the service (e.g., "google", "uber").
   * @returns The price in USD, or null if not found.
   */
  async fetchAndCacheServicePrice(serviceName: string): Promise<number | null> {
    console.log(
      `[Panda][Price] Fetching price for service: ${serviceName}`,
    );
    const cacheKey = `textverified:price:${serviceName}`;

    // 1. Check Redis cache first
    const cachedPrice = await redis.get(cacheKey);
    if (cachedPrice && cachedPrice !== "-1" && parseFloat(cachedPrice) > 0) {
      console.log(
        `[Panda][Cache] ✓ HIT for ${serviceName}: $${cachedPrice}`,
      );
      return parseFloat(cachedPrice);
    }

    console.log(`[Panda][Cache] ✗ MISS for ${serviceName}`);

    // 2. Try to get price from the services list (which may have prices from API)
    try {
      const services = await this.getAvailableServices();
      const service = services.find(
        (s: any) =>
          s.code === serviceName ||
          s.name?.toLowerCase() === serviceName.toLowerCase(),
      );

      if (service && service.price > 0) {
        console.log(
          `[Panda][Price] Found price from services list for ${serviceName}: $${service.price}`,
        );
        await redis.set(cacheKey, service.price.toString(), 60 * 60 * 24);
        return service.price;
      }
    } catch (e) {
      console.warn(`[Panda][Price] Failed to get services list:`, e);
    }

    // 3. Fallback to default base price
    const defaultPrice = 0; // Minimum base price in USD

    console.log(
      `[Panda][Price] Using default base price for ${serviceName}: $${defaultPrice.toFixed(
        2,
      )}`,
    );

    await redis.set(cacheKey, defaultPrice.toString(), 60 * 60 * 24); // Cache for 24 hours

    console.log(
      `[Panda][Price] ✓ Cached price for ${serviceName}: $${defaultPrice.toFixed(
        2,
      )}`,
    );

    return defaultPrice;
  }

  async requestNumber(
    serviceName: string,
    country: string,
    orderId: string,
  ): Promise<{ id: string; phoneNumber: string; cost?: number }> {
    console.log("\n╔════════════════════════════════════════════════╗");
    console.log("║  Panda - Requesting Number");
    console.log("╚════════════════════════════════════════════════╝");
    console.log(`[Panda][Request] Order ID: ${orderId}`);
    console.log(`[Panda][Request] Service: ${serviceName}`);
    console.log(`[TextVeriPandafied][Request] Country: ${country}`);

    if (country !== "US") {
      console.error(`[Panda][Request] ✗ Invalid country: ${country}`);
      throw new Error("Panda only supports the US.");
    }

    console.log(`[Panda][Request] Step 1: Getting bearer token...`);
    const bearerToken = await this.getBearerToken();
    console.log(`[Panda][Request] ✓ Bearer token obtained`);

    const verificationUrl = `${this.apiUrl}/verifications`;

    console.log(
      `[Panda][Request] Step 2: Fetching service capability...`,
    );
    // Fetch the service capability from the services list
    const services = await this.getAvailableServices();
    const service = services.find((s: any) => s.code === serviceName);
    const capability = service?.capability || "sms";

    console.log(`[Panda][Request] ✓ Capability: ${capability}`);
    console.log(`[Panda][Request] Step 3: Creating verification...`);

    const body = {
      serviceName,
      capability,
    };

    console.log(
      `[Panda][Request] Request body:`,
      JSON.stringify(body, null, 2),
    );

    const res = await fetchWithRetry(verificationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    console.log(
      `[Panda][Response] Status: ${res.status} ${res.statusText}`,
    );

    // Check if response is JSON before parsing
    const contentType = res.headers.get("content-type");
    let responseData: any;

    if (contentType && contentType.includes("application/json")) {
      responseData = await res.json();
      console.log(
        `[Panda][Response] Body:`,
        JSON.stringify(responseData, null, 2),
      );
    } else {
      const textResponse = await res.text();
      console.error(
        `[Panda][Response] ✗ Non-JSON response (${res.status}):`,
        textResponse.substring(0, 500),
      );
      throw new Error(
        `Panda API returned non-JSON response (${
          res.status
        }): ${textResponse.substring(0, 200)}`,
      );
    }

    if (!res.ok) {
      const errorMsg =
        responseData.message ||
        responseData.error ||
        JSON.stringify(responseData);
      console.error(
        `[Panda][Response] ✗ Request failed (${res.status}): ${errorMsg}`,
      );
      console.log("╚════════════════════════════════════════════════╝\n");
      throw new Error(
        `Failed to request number from TextVerified (${res.status}): ${errorMsg}`,
      );
    }

    // New API returns an href to the verification details instead of an ID.
    const href: string | undefined = responseData.href;
    if (!href) {
      console.error(
        `[Panda][Response] ✗ Missing verification href in response`,
      );
      console.log("╚════════════════════════════════════════════════╝\n");
      throw new Error(
        `Panda response missing verification href: ${JSON.stringify(
          responseData,
        )}`,
      );
    }

    // Use the href as the external identifier; also keep a short id if needed
    const shortId = href.split("/").pop();

    console.log(`[Panda][Success] ✓ Verification created`);
    console.log(`[Panda][Success]   Href: ${href}`);
    if (shortId) console.log(`[Panda][Success]   ID: ${shortId}`);
    console.log(
      `[Panda][Success]   Number: ${responseData.number || "pending"}`,
    );
    console.log(
      `[Panda][Success]   Cost: $${responseData.price || "N/A"}`,
    );
    console.log("╚════════════════════════════════════════════════╝\n");

    // Phone number will be provided after polling the verification details.
    return {
      id: href,
      phoneNumber: responseData.number,
      cost: responseData.price,
    };
  }

  // Fetch verification details via href and extract status/number
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
        `[Panda] Failed to fetch verification details (${res.status}): ${text}`,
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
