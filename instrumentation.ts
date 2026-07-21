export const runtime = "nodejs";

import { prisma } from "@/lib/server/prisma";
import { OrderService } from "@/lib/server/services/order.service";

// Global guards to avoid overlaps/hot-reload dupes
declare global {
  var __orderExpirerInterval: NodeJS.Timer | undefined;
  var __orderExpirerRunning: boolean | undefined;
  var __orderExpirerStarted: boolean | undefined;
}

const ACTIVE_STATUSES = ["PENDING", "PROCESSING", "WAITING_FOR_SMS"] as const;

async function sweepOverdueOrders() {
  if (global.__orderExpirerRunning) return;
  global.__orderExpirerRunning = true;
  const startedAt = new Date();
  const service = new OrderService();
  let checked = 0;
  let expired = 0;
  try {
    const now = new Date();
    const overdue = await prisma.order.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: {
        expiresAt: { lt: now },
        status: { in: ACTIVE_STATUSES as unknown as any },
      },
      select: { id: true },
      take: 200,
    });
    checked = overdue.length;
    for (const o of overdue) {
      try {
        await service.getOrderStatus(o.id);
        expired++;
      } catch (e) {
        // Swallow per-order errors; they are logged in service
        console.error("[OrderExpirer] Sweep failure for", o.id, e);
      }
    }
  } catch (e) {
    console.error("[OrderExpirer] Sweep error", e);
  } finally {
    try {
      await prisma.systemLog.create({
        data: {
          level: "INFO",
          service: "order-expirer",
          message: "Periodic overdue sweep",
          metadata: { checked, expired, startedAt, finishedAt: new Date() },
        },
      });
    } catch {}
    global.__orderExpirerRunning = false;
  }
}

export async function register() {
  // Allow disabling via env, default enabled in production
  const disabled = process.env.ORDER_EXPIRER_ENABLED === "false";
  if (disabled) return;

  if (global.__orderExpirerStarted) return;
  global.__orderExpirerStarted = true;

  const intervalMs = parseInt(
    process.env.ORDER_EXPIRER_INTERVAL_MS || "60000",
    10,
  );

  // Start a periodic, non-overlapping sweep
  if (!global.__orderExpirerInterval) {
    global.__orderExpirerInterval = setInterval(() => {
      // Fire and forget; guarded by __orderExpirerRunning
      void sweepOverdueOrders();
    }, intervalMs);

    // Kick off an initial sweep shortly after boot
    setTimeout(() => void sweepOverdueOrders(), 5000);

    // Warm lightweight catalog + full price index on startup so the first
    // Buy Number page load hits a warm skeleton (seconds) and countries
    // endpoint already has the indexed price matrix.
    setTimeout(() => {
      void (async () => {
        try {
          const { getServicesCatalog, buildAndCacheServices } =
            await import("@/lib/server/services/services-catalog.service");
          console.log("[Startup] Warming services catalog...");
          await getServicesCatalog(); // skeleton first
          await buildAndCacheServices(); // full countries/price index
          console.log("[Startup] ✓ Services catalog cache warmed");
        } catch (e) {
          console.warn("[Startup] Catalog warm failed:", e);
        }
      })();
    }, 3000); // 3s after boot — after initial auth setup completes

    console.log(
      `[OrderExpirer] Registered background sweeper (interval=${intervalMs}ms)`,
    );
  }
}
