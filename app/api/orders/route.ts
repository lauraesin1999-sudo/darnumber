import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { OrderService } from "@/lib/server/services/order.service";
import { prisma } from "@/lib/server/prisma";
import { getRedisService } from "@/lib/server/services/redis.service";

export const runtime = "nodejs";

const redis = getRedisService();
const ORDERS_CACHE_TTL = 45;

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.user.id;
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || 1);
    const limit = Number(searchParams.get("limit") || 20);

    // Filter parameters for cache key + query
    const status = searchParams.get("status") || "all";
    const search = searchParams.get("search") || "";
    const startDate = searchParams.get("startDate") || "";
    const endDate = searchParams.get("endDate") || "";

    const filterKey = `${status}:${search}:${startDate}:${endDate}`;

    // Short-lived per-user per-filter cache (dramatically cuts repeated DB hits on list reloads)
    // Cache read is best-effort — fall through to DB on Redis failure
    try {
      const cached = await redis.getUserOrders(userId, page, limit, filterKey);
      if (cached) {
        return json({ ok: true, data: cached });
      }
    } catch {
      // Redis unavailable — continue to DB
    }

    const skip = (page - 1) * limit;

    // Build where clause
    const where: any = { userId };

    if (status && status !== "all") {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search, mode: "insensitive" } },
        { phoneNumber: { contains: search, mode: "insensitive" } },
        { serviceCode: { contains: search, mode: "insensitive" } },
        { smsCode: { contains: search, mode: "insensitive" } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    const result = {
      orders,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };

    // Cache write is fire-and-forget
    redis.setUserOrders(userId, page, limit, filterKey, result, ORDERS_CACHE_TTL).catch(() => {});

    return json({ ok: true, data: result });
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}

export async function POST(req: NextRequest) {
  console.log("=== POST /api/orders START ===");
  try {
    console.log("1. Authenticating user...");
    const session = await requireAuth();
    console.log("2. ✅ User authenticated:", {
      userId: session.user.id,
      email: session.user.email,
    });

    console.log("3. Parsing request body...");
    const body = await req.json();
    const { serviceCode, country, provider, price } = body || {};

    console.log("4. Request data:", {
      serviceCode,
      country,
      provider,
      price,
      priceType: typeof price,
      body: JSON.stringify(body),
    });

    if (!serviceCode || !country || !price) {
      console.log("5. ❌ Validation failed - Missing required fields:", {
        hasServiceCode: !!serviceCode,
        hasCountry: !!country,
        hasPrice: !!price,
        priceValue: price,
      });
      return error("serviceCode, country, and price are required", 400);
    }

    if (typeof price !== "number" || price <= 0 || isNaN(price)) {
      console.log("5. ❌ Validation failed - Invalid price:", {
        price,
        type: typeof price,
      });
      return error("Price must be a positive number", 400);
    }

    console.log("5. ✅ Validation passed, creating order...");
    console.log("   serviceCode:", serviceCode);
    console.log("   country:", country);
    console.log("   provider:", provider);
    console.log("   price (NGN):", price);
    const service = new OrderService();
    const result = await service.createOrder({
      userId: session.user.id,
      serviceCode,
      country,
      price,
      preferredProvider: provider,
    });

    console.log("6. ✅ Order created successfully:", result);
    console.log("=== POST /api/orders END (SUCCESS) ===");

    // Bust relevant user caches so lists/stats/balance update immediately
    try {
      await redis.invalidateUserBalance(session.user.id);
      // Rough invalidation for stats (the key includes days)
      const statKeys = await redis.keys(`user:stats:${session.user.id}:*`);
      if (statKeys.length) await redis.del(...statKeys);
      // Orders list will be slightly stale for 45s max — acceptable
    } catch {}

    return json({ ok: true, data: result });
  } catch (e) {
    console.error("=== POST /api/orders ERROR ===");
    console.error("Error details:", {
      message: e instanceof Error ? e.message : "Unknown error",
      stack: e instanceof Error ? e.stack : undefined,
      error: e,
    });

    const msg = e instanceof Error ? e.message : "Unexpected error";
    const lowerMsg = msg.toLowerCase();
    const status = msg.includes("balance")
      ? 402
      : lowerMsg.includes("no providers currently have stock") ||
          lowerMsg.includes("out of stock") ||
          lowerMsg.includes("unavailable")
        ? 503
        : 400;
    if (msg === "Unauthorized") {
      console.log("Returning 401 Unauthorized");
      return error("Unauthorized", 401);
    }
    console.log(`Returning ${status} error:`, msg);
    return error(msg, status);
  }
}
