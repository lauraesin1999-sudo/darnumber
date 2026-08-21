import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json();

    const { bankAccount, accountNumber, bankName } = body;

    // Validate required fields
    if (!bankAccount || !accountNumber || !bankName) {
      return error("All bank details are required", 400);
    }

    // Update user bank details
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        bankAccount,
        accountNumber,
        bankName,
      },
      select: {
        id: true,
        bankAccount: true,
        accountNumber: true,
        bankName: true,
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "BANK_DETAILS_UPDATED",
        resource: "user",
        resourceId: session.user.id,
        metadata: { bankName },
      },
    });

    logger.info("[Route][Users][BankDetails] Updated successfully", {
      userId: session.user.id,
    });

    return json({
      ok: true,
      data: user,
    });
  } catch (e) {
    logger.error("[Route][Users][BankDetails] Error:", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
