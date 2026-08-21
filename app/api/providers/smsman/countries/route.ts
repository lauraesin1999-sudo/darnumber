import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(_req: NextRequest) {
  try {
    const token =
      process.env.SMSMAN_API_KEY || process.env.NEXT_PUBLIC_SMSMAN_API_KEY;
    if (!token) return error("SMS-Man API key not configured", 500);

    const res = await fetch(
      "https://api.sms-man.com/control/countries?token=" + token,
      { cache: "no-store" }
    );
    if (!res.ok) return error("Failed to fetch countries", res.status);
    const data = (await res.json()) as Record<
      string,
      { id: string; title: string; code: string }
    >;
    const map: Record<string, string> = {};
    Object.values(data).forEach((c) => {
      if (c?.code && c?.title) map[String(c.code).toUpperCase()] = c.title;
    });
    return json({ ok: true, data: { countries: map } });
  } catch (e) {
    logger.error("[Countries] error", e);
    return error("Unexpected error", 500);
  }
}
