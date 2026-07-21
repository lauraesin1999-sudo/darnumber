import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { AdminService } from "@/lib/server/services/admin.service";
import { getRedisService } from "@/lib/server/services/redis.service";

export const runtime = "nodejs";

const redis = getRedisService();
const ADMIN_CACHE_TTL = 300; // 5 minutes — admin views are infrequent but queries are heavy

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session.user.role !== "ADMIN" && session.user.role !== "SUPER_ADMIN")
      return error("Forbidden", 403);

    const sp = new URL(req.url).searchParams;
    const days = Number(sp.get("days") || 30);

    // Serve from cache for admin analytics (big aggregates) — best-effort
    try {
      const cached = await redis.getAdminDashboard(days);
      if (cached) {
        return json({ ok: true, data: cached });
      }
    } catch {
      // Redis unavailable — continue to DB
    }

    const svc = new AdminService();
    const data = await svc.getDashboardAnalytics(days);

    // Cache write is fire-and-forget
    redis.setAdminDashboard(days, data, ADMIN_CACHE_TTL).catch(() => {});

    return json({ ok: true, data });
  } catch (e) {
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
