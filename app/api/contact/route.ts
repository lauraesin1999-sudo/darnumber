import { NextRequest } from "next/server";
import { error, json } from "@/lib/server/utils/response";
import {
  sendContactNotificationToAdmin,
  sendContactConfirmationEmail,
} from "@/lib/server/services/email.service";
import crypto from "crypto";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

// Rate limiting storage (in production, use Redis)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5; // 5 requests per window
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    // Get client IP for rate limiting
    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("x-real-ip") ||
      "unknown";

    // Check rate limit
    if (!checkRateLimit(ip)) {
      return error("Too many requests. Please try again later.", 429);
    }

    const body = await req.json();
    const { name, email, phone, category, subject, message } = body || {};

    // Validate required fields
    if (!name || !name.trim()) {
      return error("Name is required", 400);
    }

    if (!email || !email.trim()) {
      return error("Email is required", 400);
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return error("Invalid email format", 400);
    }

    if (!category || !category.trim()) {
      return error("Category is required", 400);
    }

    if (!subject || !subject.trim()) {
      return error("Subject is required", 400);
    }

    if (!message || !message.trim()) {
      return error("Message is required", 400);
    }

    // Validate message length
    if (message.length < 10) {
      return error("Message must be at least 10 characters", 400);
    }

    if (message.length > 5000) {
      return error("Message must be less than 5000 characters", 400);
    }

    // Sanitize inputs
    const ticketId = crypto.randomBytes(6).toString("hex").toUpperCase();
    const sanitizedData = {
      name: name.trim().slice(0, 100),
      email: email.trim().toLowerCase().slice(0, 255),
      phone: phone?.trim().slice(0, 20) || undefined,
      category: category.trim().slice(0, 50),
      subject: subject.trim().slice(0, 200),
      message: message.trim().slice(0, 5000),
      ticketId,
    };

    // Send notification email to support team
    const supportEmailResult = await sendContactNotificationToAdmin(
      sanitizedData
    );

    if (!supportEmailResult) {
      logger.error("Failed to send contact form to support");
      return error("Failed to send your message. Please try again later.", 500);
    }

    // Send confirmation email to user
    const confirmationResult = await sendContactConfirmationEmail(
      sanitizedData.email,
      sanitizedData.name,
      ticketId
    );

    if (!confirmationResult) {
      logger.error("Failed to send confirmation email");
      // Don't fail the request - the main email was sent
    }

    return json({
      success: true,
      message:
        "Your message has been sent successfully. We will get back to you soon.",
    });
  } catch (e) {
    logger.error("Contact form error:", e);
    return error("Failed to process your request", 500);
  }
}
