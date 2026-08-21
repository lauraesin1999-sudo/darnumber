import { NextRequest } from "next/server";
import { json, error } from "@/lib/server/utils/response";
import { requireAuth } from "@/lib/server/auth";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        userName: true,
        phone: true,
        name: true,
        country: true,
        balance: true,
        currency: true,
        status: true,
        role: true,
        emailVerified: true,
        phoneVerified: true,
        referralCode: true,
        referredBy: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    if (!user) return error("User not found", 404);

    logger.info("[Route][Users][Profile] Fetched successfully", {
      userId: session.user.id,
    });

    return json({
      ok: true,
      data: {
        ...user,
        balance: Number(user.balance),
      },
    });
  } catch (e) {
    logger.error("[Route][Users][Profile] Error:", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireAuth();
    const body = await req.json();

    const { userName, phone, country } = body;

    // Build update data
    const updateData: any = {};
    if (userName !== undefined) updateData.userName = userName;
    if (phone !== undefined) updateData.phone = phone;
    if (country !== undefined) updateData.country = country;

    // Check if userName is already taken
    if (userName) {
      const existing = await prisma.user.findFirst({
        where: {
          userName,
          id: { not: session.user.id },
        },
      });
      if (existing) return error("Username already taken", 400);
    }

    // Check if phone is already taken
    if (phone) {
      const existing = await prisma.user.findFirst({
        where: {
          phone,
          id: { not: session.user.id },
        },
      });
      if (existing) return error("Phone number already taken", 400);
    }

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        userName: true,
        phone: true,
        name: true,
        country: true,
        balance: true,
        currency: true,
        status: true,
        role: true,
        emailVerified: true,
        phoneVerified: true,
        referralCode: true,
        referredBy: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: session.user.id,
        action: "PROFILE_UPDATED",
        resource: "user",
        resourceId: session.user.id,
        metadata: { changes: updateData },
      },
    });

    logger.info("[Route][Users][Profile] Updated successfully", {
      userId: session.user.id,
      changes: Object.keys(updateData),
    });

    return json({
      ok: true,
      data: {
        ...user,
        balance: Number(user.balance),
      },
    });
  } catch (e) {
    logger.error("[Route][Users][Profile] Update error:", e);
    if (e instanceof Error && e.message === "Unauthorized")
      return error("Unauthorized", 401);
    return error("Unexpected error", 500);
  }
}
