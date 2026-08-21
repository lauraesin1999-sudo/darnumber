import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import { json, error } from "@/lib/server/utils/response";
import { PaymentService } from "@/lib/server/services/payment.service";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await requireAuth();
    logger.info("[DVA][GET] userId=", session.user.id);
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { bankName: true, accountNumber: true, bankAccount: true },
    });
    if (!user) return error("User not found", 404);
    const hasDva = !!(user.bankName && user.accountNumber && user.bankAccount);
    if (!hasDva) {
      return json({ ok: true, data: null });
    }
    return json({
      ok: true,
      data: {
        bankName: user.bankName,
        accountNumber: user.accountNumber,
        accountName: user.bankAccount,
      },
    });
  } catch (e) {
    logger.error("[DVA][GET][ERROR]", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    const msg = e instanceof Error ? e.message : "Unexpected error";
    return error(msg, 400);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const preferredBank = (body?.preferredBank as string | undefined)?.trim();
    logger.info(
      "[DVA][POST] userId=",
      session.user.id,
      "preferredBank=",
      preferredBank
    );
    // Optional guard: basic bank name sanity
    if (preferredBank && preferredBank.length < 3) {
      return error("Invalid preferred bank name", 400);
    }
    const svc = new PaymentService();
    const data = await svc.requestPaystackDedicatedAccount(
      session.user.id,
      preferredBank
    );
    logger.info("[DVA][POST] assigned=", data);
    if ((data as any)?.status === "PENDING") {
      // Inform client that assignment is in progress
      return json({ ok: true, data }, { status: 202 });
    }
    return json({ ok: true, data });
  } catch (e) {
    logger.error("[DVA][POST][ERROR]", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    const msg = e instanceof Error ? e.message : "Unexpected error";
    // Provide actionable guidance for common config issues
    if (msg.includes("Paystack secret not configured")) {
      return error(
        "Paystack secret not configured. Set PAYSTACK_SECRET_KEY in .env and restart the server.",
        400
      );
    }
    if (msg.toLowerCase().includes("failed to create paystack customer")) {
      return error(
        "Failed to create Paystack customer. Verify PAYSTACK_SECRET_KEY and user details (email, phone).",
        400
      );
    }
    if (msg.toLowerCase().includes("failed to assign dedicated account")) {
      return error(
        "Failed to assign dedicated account. Ensure the customer exists and PAYSTACK_SECRET_KEY is correct.",
        400
      );
    }
    return error(msg, 400);
  }
}
