// migration.ts - MySQL to PostgreSQL Migration Script
import { PrismaClient as MySQLPrisma } from "@prisma/client-mysql";
import { PrismaClient as PostgresPrisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash } from "crypto";
import { logger } from "@/lib/logger";

const mysqlPrisma = new MySQLPrisma();
const postgresPrisma = new PostgresPrisma();

interface LegacyUser {
  id: number;
  user_name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  balance: number;
  password: string;
  token: string;
  bank_account: string;
  account_number: string;
  bank_name: string;
  account_number_22: string;
  json: string;
  currency: string;
  del: string;
  promo_code: string;
  country: string;
  bank_token: string;
}

async function migrateUsers() {
  logger.info("Starting user migration...");

  try {
    // Fetch all users from MySQL
    const legacyUsers: LegacyUser[] = await mysqlPrisma.$queryRaw`
      SELECT * FROM users WHERE del != '1' OR del IS NULL
    `;

    logger.info(`Found ${legacyUsers.length} users to migrate`);

    let migrated = 0;
    let failed = 0;

    for (const legacyUser of legacyUsers) {
      try {
        // Parse date and time
        const createdAt = parseDateTime(legacyUser.date, legacyUser.time);

        // Hash password if not already hashed
        const hashedPassword = isPasswordHashed(legacyUser.password)
          ? legacyUser.password
          : await bcrypt.hash(legacyUser.password, 12);

        // Generate unique referral code
        const referralCode = generateReferralCode(legacyUser.user_name);

        // Create user in PostgreSQL
        await postgresPrisma.user.create({
          data: {
            id: `legacy_${legacyUser.id}`, // Prefix to avoid conflicts
            email: legacyUser.email || `user${legacyUser.id}@migrated.local`,
            phone: legacyUser.phone || null,
            userName: legacyUser.user_name || `User${legacyUser.id}`,
            password: hashedPassword,
            balance: legacyUser.balance || 0,
            currency: legacyUser.currency || "NGN",
            bankAccount: legacyUser.bank_account || null,
            accountNumber: legacyUser.account_number || null,
            bankName: legacyUser.bank_name || null,
            country: legacyUser.country || null,
            promoCode: legacyUser.promo_code || null,
            referralCode: referralCode,
            emailVerified: !!legacyUser.email,
            status: "ACTIVE",
            role: "USER",
            createdAt: createdAt,
            updatedAt: createdAt,
            lastLoginAt: createdAt,
            // Create initial session if token exists
            sessions: legacyUser.token
              ? {
                  create: {
                    token: legacyUser.token,
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                  },
                }
              : undefined,
          },
        });

        migrated++;

        if (migrated % 100 === 0) {
          logger.info(`Migrated ${migrated} users...`);
        }
      } catch (error) {
        failed++;
        logger.error(`Failed to migrate user ${legacyUser.id}:`, error);

        // Log failed migration
        await postgresPrisma.systemLog.create({
          data: {
            level: "ERROR",
            service: "migration",
            message: `Failed to migrate user ${legacyUser.id}`,
            error: JSON.stringify(error),
            metadata: { userId: legacyUser.id, email: legacyUser.email },
          },
        });
      }
    }

    logger.info(`\nMigration complete!`);
    logger.info(`✓ Successfully migrated: ${migrated}`);
    logger.info(`✗ Failed: ${failed}`);
  } catch (error) {
    logger.error("Migration failed:", error);
    throw error;
  }
}

async function seedInitialData() {
  logger.info("\nSeeding initial data...");

  // Create default providers
  const smsManProvider = await postgresPrisma.provider.create({
    data: {
      name: "sms-man",
      displayName: "SMS-Man",
      apiKey: process.env.SMSMAN_API_KEY || "",
      apiUrl: "https://api.sms-man.com/control",
      isActive: true,
      priority: 1,
      rateLimit: 1000,
      config: {
        supportedCountries: ["US", "UK", "CA", "DE", "FR"],
      },
    },
  });

  const textVerifiedProvider = await postgresPrisma.provider.create({
    data: {
      name: "textverified",
      displayName: "TextVerified",
      apiKey: process.env.TEXTVERIFIED_API_KEY || "",
      apiUrl: "https://www.textverified.com/api",
      isActive: true,
      priority: 2,
      rateLimit: 500,
      config: {
        supportedCountries: ["US", "UK", "CA"],
      },
    },
  });

  logger.info("✓ Created providers");

  // Create default pricing rules
  await postgresPrisma.pricingRule.createMany({
    data: [
      {
        serviceCode: null, // Applies to all services
        country: null,
        profitType: "PERCENTAGE",
        profitValue: 30, // 30% markup
        priority: 0,
        isActive: true,
      },
      {
        serviceCode: "google",
        country: "US",
        profitType: "PERCENTAGE",
        profitValue: 25, // 25% markup for Google US
        priority: 10,
        isActive: true,
      },
    ],
  });

  logger.info("✓ Created pricing rules");

  // Create admin user
  const adminPassword = await bcrypt.hash(
    process.env.ADMIN_PASSWORD || "change-me-immediately",
    12
  );

  await postgresPrisma.user.create({
    data: {
      email: process.env.ADMIN_EMAIL || "admin@example.com",
      userName: "Admin",
      password: adminPassword,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      emailVerified: true,
      balance: 0,
      currency: "NGN",
      referralCode: "ADMIN001",
    },
  });

  logger.info("✓ Created admin user");

  // Create system config
  await postgresPrisma.systemConfig.createMany({
    data: [
      {
        key: "referral_reward_amount",
        value: { amount: 5, currency: "NGN" },
        description: "Reward amount for successful referrals",
      },
      {
        key: "min_deposit_amount",
        value: { amount: 10, currency: "NGN" },
        description: "Minimum deposit amount",
      },
      {
        key: "order_timeout_minutes",
        value: { minutes: 20 },
        description: "Time before order expires",
      },
    ],
  });

  logger.info("✓ Created system config");
}

// Helper functions
function parseDateTime(dateStr: string, timeStr: string): Date {
  try {
    if (!dateStr) return new Date();

    // Handle various date formats
    const date = new Date(dateStr);

    if (timeStr) {
      const [hours, minutes, seconds] = timeStr.split(":");
      date.setHours(parseInt(hours) || 0);
      date.setMinutes(parseInt(minutes) || 0);
      date.setSeconds(parseInt(seconds) || 0);
    }

    return isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

function isPasswordHashed(password: string): boolean {
  // Check if password is already bcrypt hashed
  return password.startsWith("$2a$") || password.startsWith("$2b$");
}

function generateReferralCode(userName: string): string {
  const base = userName.substring(0, 4).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${base}${random}`;
}

// Verify migration
async function verifyMigration() {
  logger.info("\nVerifying migration...");

  const userCount = await postgresPrisma.user.count();
  const sessionCount = await postgresPrisma.session.count();
  const providerCount = await postgresPrisma.provider.count();

  logger.info(`✓ Users: ${userCount}`);
  logger.info(`✓ Sessions: ${sessionCount}`);
  logger.info(`✓ Providers: ${providerCount}`);
}

// Main execution
async function main() {
  try {
    logger.info("=== Starting Migration ===\n");

    await migrateUsers();
    await seedInitialData();
    await verifyMigration();

    logger.info("\n=== Migration Successful ===");
  } catch (error) {
    logger.error("\n=== Migration Failed ===");
    logger.error(error);
    process.exit(1);
  } finally {
    await mysqlPrisma.$disconnect();
    await postgresPrisma.$disconnect();
  }
}

main();
