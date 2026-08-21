import { Resend } from "resend";
import { logger } from "@/lib/logger";

// Email configuration from environment variables
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM =
  process.env.EMAIL_FROM || "DarNumber <noreply@darnumber.com>";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://darnumber.com";

// Create Resend client
const createResendClient = () => {
  if (!RESEND_API_KEY) {
    logger.warn(
      "[EmailService] Resend API key not configured. Emails will be logged to console."
    );
    return null;
  }

  return new Resend(RESEND_API_KEY);
};

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email using Resend
 */
export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const resend = createResendClient();

  // If no resend client (API key not configured), log to console
  if (!resend) {
    logger.info("\n========== EMAIL (DEV MODE) ==========");
    logger.info(`To: ${options.to}`);
    logger.info(`Subject: ${options.subject}`);
    logger.info(`Body:\n${options.text || options.html}`);
    logger.info("=======================================\n");
    return true;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      logger.error("[EmailService] Failed to send email:", error);
      return false;
    }

    logger.info(`[EmailService] Email sent successfully to ${options.to}`);
    return true;
  } catch (error) {
    logger.error("[EmailService] Failed to send email:", error);
    return false;
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string,
  userName?: string
): Promise<boolean> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #667eea; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">DarNumber</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="color: #1f2937; margin-top: 0;">Reset Your Password</h2>
    
    <p>Hi${userName ? ` ${userName}` : ""},</p>
    
    <p>We received a request to reset the password for your DarNumber account. Click the button below to set a new password:</p>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${resetUrl}" style="background: #667eea; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
        Reset Password
      </a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="background: #e5e7eb; padding: 10px; border-radius: 5px; word-break: break-all; font-size: 12px;">
      <a href="${resetUrl}" style="color: #4f46e5;">${resetUrl}</a>
    </p>
    
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
      <p style="color: #6b7280; font-size: 14px; margin: 0;">
        <strong>This link will expire in 1 hour.</strong>
      </p>
      <p style="color: #6b7280; font-size: 14px;">
        If you didn't request this password reset, you can safely ignore this email. Your password will remain unchanged.
      </p>
    </div>
  </div>
  
  <div style="background: #1f2937; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      © ${new Date().getFullYear()} DarNumber. All rights reserved.
    </p>
    <p style="color: #9ca3af; font-size: 12px; margin: 10px 0 0 0;">
      Lagos, Nigeria
    </p>
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: "Reset Your Password - DarNumber",
    html,
  });
}

/**
 * Send contact form confirmation email to user
 */
export async function sendContactConfirmationEmail(
  email: string,
  name: string,
  ticketId: string
): Promise<boolean> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>We Received Your Message</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #667eea; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">DarNumber</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="color: #1f2937; margin-top: 0;">We Received Your Message!</h2>
    
    <p>Hi ${name},</p>
    
    <p>Thank you for contacting DarNumber support. We've received your message and our team will get back to you as soon as possible.</p>
    
    <div style="background: #e5e7eb; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <p style="margin: 0; font-size: 14px; color: #6b7280;">Your Reference Number:</p>
      <p style="margin: 5px 0 0 0; font-size: 20px; font-weight: 600; color: #1f2937; font-family: monospace;">${ticketId}</p>
    </div>
    
    <p style="color: #6b7280; font-size: 14px;">
      Please keep this reference number for your records. You may need it when following up on your inquiry.
    </p>
    
    <p style="color: #6b7280; font-size: 14px;">
      <strong>Expected Response Time:</strong> Within 24 hours (business days)
    </p>
  </div>
  
  <div style="background: #1f2937; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      © ${new Date().getFullYear()} DarNumber. All rights reserved.
    </p>
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: `Message Received [#${ticketId}] - DarNumber Support`,
    html,
  });
}

/**
 * Send contact form notification to admin
 */
export async function sendContactNotificationToAdmin(data: {
  name: string;
  email: string;
  phone?: string;
  category: string;
  subject?: string;
  message: string;
  ticketId: string;
}): Promise<boolean> {
  const adminEmail = process.env.ADMIN_EMAIL;

  if (!adminEmail) {
    logger.warn(
      "[EmailService] No admin email configured for contact notifications"
    );
    return false;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Contact Form Submission</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #dc2626; padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 24px;">New Contact Form Submission</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <div style="background: #fee2e2; padding: 10px 15px; border-radius: 8px; margin-bottom: 20px;">
      <p style="margin: 0; font-size: 14px; color: #dc2626;">
        <strong>Ticket ID:</strong> ${data.ticketId}
      </p>
    </div>

    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600; width: 120px;">Name:</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">${
          data.name
        }</td>
      </tr>
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Email:</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;"><a href="mailto:${
          data.email
        }">${data.email}</a></td>
      </tr>
      ${
        data.phone
          ? `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Phone:</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">${data.phone}</td>
      </tr>
      `
          : ""
      }
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Category:</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">${
          data.category
        }</td>
      </tr>
      ${
        data.subject
          ? `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb; font-weight: 600;">Subject:</td>
        <td style="padding: 10px 0; border-bottom: 1px solid #e5e7eb;">${data.subject}</td>
      </tr>
      `
          : ""
      }
    </table>
    
    <div style="margin-top: 20px;">
      <p style="font-weight: 600; margin-bottom: 10px;">Message:</p>
      <div style="background: white; padding: 15px; border-radius: 8px; border: 1px solid #e5e7eb; white-space: pre-wrap;">${
        data.message
      }</div>
    </div>
    
    <div style="margin-top: 20px; text-align: center;">
      <a href="mailto:${data.email}?subject=Re: ${
    data.subject || `Support Request [#${data.ticketId}]`
  }" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
        Reply to Customer
      </a>
    </div>
  </div>
  
  <div style="background: #1f2937; padding: 15px; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      DarNumber Admin Notification
    </p>
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: adminEmail,
    subject: `[Support] ${data.category}: ${data.subject || "New Inquiry"} [#${
      data.ticketId
    }]`,
    html,
  });
}

/**
 * Send welcome email to new users
 */
export async function sendWelcomeEmail(
  email: string,
  userName: string
): Promise<boolean> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to DarNumber</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #667eea; padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to DarNumber!</h1>
  </div>
  
  <div style="background: #f9fafb; padding: 30px; border: 1px solid #e5e7eb; border-top: none;">
    <h2 style="color: #1f2937; margin-top: 0;">Hey ${userName}! 🎉</h2>
    
    <p>Welcome to DarNumber - your trusted SMS verification service. We're excited to have you on board!</p>
    
    <h3 style="color: #1f2937;">Here's what you can do:</h3>
    <ul style="color: #4b5563;">
      <li>Buy phone numbers for SMS verification</li>
      <li>Receive verification codes instantly</li>
      <li>Access numbers from multiple countries</li>
      <li>Manage your orders and transactions</li>
    </ul>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="${APP_URL}/dashboard" style="background: #667eea; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">
        Go to Dashboard
      </a>
    </div>
    
    <p style="color: #6b7280; font-size: 14px;">
      Need help? Visit our <a href="${APP_URL}/contact" style="color: #4f46e5;">Contact Page</a> or email us at support@darnumber.com
    </p>
  </div>
  
  <div style="background: #1f2937; padding: 20px; border-radius: 0 0 10px 10px; text-align: center;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      © ${new Date().getFullYear()} DarNumber. All rights reserved.
    </p>
  </div>
</body>
</html>
  `;

  return sendEmail({
    to: email,
    subject: "Welcome to DarNumber! 🎉",
    html,
  });
}
