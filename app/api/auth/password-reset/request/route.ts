import { NextRequest } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { error, json } from "@/lib/server/utils/response";
import { sendPasswordResetEmail } from "@/lib/server/services/email.service";
import crypto from "crypto";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body || {};

    if (!email) {
      return error("Email is required", 400);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return error("Invalid email format", 400);
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, userName: true, email: true },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return json({
        success: true,
        message:
          "If an account exists with this email, you will receive a password reset link.",
      });
    }

    // Invalidate any existing reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        used: false,
        expiresAt: { gt: new Date() },
      },
      data: { used: true },
    });

    // Generate a secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Save the token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // Send email
    const emailResult = await sendPasswordResetEmail(
      user.email,
      token,
      user.userName || "User"
    );

    if (!emailResult) {
      logger.error("Failed to send password reset email");
      // Still return success to prevent information leakage
    }

    return json({
      success: true,
      message:
        "If an account exists with this email, you will receive a password reset link.",
    });
  } catch (e) {
    logger.error("Password reset request error:", e);
    return error("Failed to process password reset request", 500);
  }
}
