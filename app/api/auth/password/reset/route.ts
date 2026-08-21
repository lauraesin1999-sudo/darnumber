import { NextRequest } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { error, json } from "@/lib/server/utils/response";
import bcrypt from "bcryptjs";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, newPassword } = body || {};

    if (!token) {
      return error("Reset token is required", 400);
    }

    if (!newPassword) {
      return error("New password is required", 400);
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return error("Password must be at least 8 characters long", 400);
    }

    // Find the reset token
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: {
        user: {
          select: { id: true, email: true, userName: true },
        },
      },
    });

    if (!resetToken) {
      return error("Invalid or expired reset token", 400);
    }

    // Check if token has been used
    if (resetToken.used) {
      return error("This reset link has already been used", 400);
    }

    // Check if token has expired
    if (resetToken.expiresAt < new Date()) {
      return error(
        "This reset link has expired. Please request a new one.",
        400
      );
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update user password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { used: true },
      }),
      // Invalidate all other reset tokens for this user
      prisma.passwordResetToken.updateMany({
        where: {
          userId: resetToken.userId,
          id: { not: resetToken.id },
          used: false,
        },
        data: { used: true },
      }),
      // Optionally, invalidate all sessions (force re-login)
      prisma.session.deleteMany({
        where: { userId: resetToken.userId },
      }),
    ]);

    // Log activity
    await prisma.activityLog.create({
      data: {
        userId: resetToken.userId,
        action: "PASSWORD_RESET",
        metadata: {
          method: "email_token",
          timestamp: new Date().toISOString(),
        },
        ipAddress:
          req.headers.get("x-forwarded-for") ||
          req.headers.get("x-real-ip") ||
          "unknown",
        userAgent: req.headers.get("user-agent") || "unknown",
      },
    });

    return json({
      success: true,
      message:
        "Password has been reset successfully. You can now login with your new password.",
    });
  } catch (e) {
    logger.error("Password reset error:", e);
    return error("Failed to reset password", 500);
  }
}
