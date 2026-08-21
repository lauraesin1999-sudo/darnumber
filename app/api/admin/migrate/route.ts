import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { logger } from "@/lib/logger";

// Parse SQL INSERT statements from the uploaded file
function parseInsertStatements(sqlContent: string) {
  logger.info("🔍 Starting SQL parsing...");
  logger.info(`📄 SQL content length: ${sqlContent.length} characters`);

  const users: any[] = [];

  // Match INSERT INTO statements with VALUES
  const insertRegex =
    /INSERT INTO `users`[^(]*\([^)]+\)\s+VALUES\s*([\s\S]+?);/g;
  const matches = Array.from(sqlContent.matchAll(insertRegex));

  logger.info(`✅ Found ${matches.length} INSERT statements`);

  for (const match of matches) {
    const valuesSection = match[1];

    // Split by ),( to get individual user records
    const userRecords = valuesSection.split(/\),\s*\(/);
    logger.info(
      `📦 Processing ${userRecords.length} user records from this INSERT statement`
    );

    for (let record of userRecords) {
      // Clean up the record
      record = record.replace(/^\(/, "").replace(/\)$/, "");

      // Parse the values - handle quoted strings and NULLs
      const values: string[] = [];
      let currentValue = "";
      let inQuote = false;
      let escapeNext = false;

      for (let i = 0; i < record.length; i++) {
        const char = record[i];

        if (escapeNext) {
          currentValue += char;
          escapeNext = false;
          continue;
        }

        if (char === "\\") {
          escapeNext = true;
          continue;
        }

        if (char === "'" && !escapeNext) {
          if (inQuote) {
            // Check if it's a doubled quote (escaped)
            if (record[i + 1] === "'") {
              currentValue += "'";
              i++;
            } else {
              inQuote = false;
            }
          } else {
            inQuote = true;
          }
          continue;
        }

        if (char === "," && !inQuote) {
          values.push(currentValue.trim());
          currentValue = "";
          continue;
        }

        currentValue += char;
      }

      // Add the last value
      if (currentValue) {
        values.push(currentValue.trim());
      }

      if (values.length >= 19) {
        // Map SQL fields to our schema
        // SQL: id, user_name, phone, email, date, time, balance, password, token,
        //      bank_account, account_number, bank_name, account_number_22, json,
        //      currency, del, promo_code, country, bank_token

        const email = values[3] || "";
        const phone = values[2] || "";
        const userName = values[1] || "";

        // Skip if essential fields are missing
        if (!email || !userName) {
          logger.info(
            `⚠️ Skipping record - missing essential fields (email: ${email}, userName: ${userName})`
          );
          continue;
        }

        const userData = {
          email,
          phone: phone || null,
          userName,
          name: userName,
          password: values[7] || "", // Already hashed in the SQL
          balance: parseFloat(values[6] || "0"),
          currency: values[14] || "NGN",
          bankAccount: values[9] === "YES" ? "YES" : null,
          accountNumber: values[10] || null,
          bankName: values[11] || null,
          promoCode: values[16] || null,
          country: values[17] || null,
          emailVerified: false,
          phoneVerified: false,
          status: "ACTIVE",
          role: "USER",
        };

        logger.info(
          `👤 Parsed user: ${email} (${userName}) - Balance: ${userData.balance} ${userData.currency}`
        );
        users.push(userData);
      }
    }
  }

  logger.info(`✅ Parsing complete. Total valid users: ${users.length}`);
  return users;
}

export async function POST(request: NextRequest) {
  logger.info("\n🚀 ========== MIGRATION REQUEST STARTED ==========");
  const startTime = Date.now();

  try {
    // Get the uploaded file
    logger.info("📥 Receiving file upload...");
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      logger.info("❌ No file uploaded");
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    logger.info(
      `📁 File received: ${file.name} (${file.size} bytes, ${file.type})`
    );

    // Read the file content
    logger.info("📖 Reading file content...");
    const content = await file.text();
    logger.info(`✅ File content read successfully`);

    // Parse the SQL file
    logger.info("\n🔧 Starting SQL parsing...");
    const users = parseInsertStatements(content);

    if (users.length === 0) {
      logger.info("❌ No valid user data found in the file");
      return NextResponse.json(
        { error: "No valid user data found in the file" },
        { status: 400 }
      );
    }

    logger.info(
      `\n💾 Starting database migration for ${users.length} users...`
    );

    // Migrate users to database
    let migratedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const userData of users) {
      try {
        logger.info(`\n🔍 Checking user: ${userData.email}`);

        // Check if user already exists
        const existingUser = await prisma.user.findUnique({
          where: { email: userData.email },
        });

        if (existingUser) {
          logger.info(`⏭️ User already exists, skipping: ${userData.email}`);
          skippedCount++;
          continue;
        }

        // Generate a unique referral code
        const referralCode = `REF${Date.now()}${Math.random()
          .toString(36)
          .substring(2, 7)
          .toUpperCase()}`;

        logger.info(
          `➕ Creating user: ${userData.email} with referral code: ${referralCode}`
        );

        // Create the user
        await prisma.user.create({
          data: {
            ...userData,
            referralCode,
          },
        });

        logger.info(`✅ Successfully created user: ${userData.email}`);
        migratedCount++;
      } catch (error) {
        logger.error(`❌ Error migrating user ${userData.email}:`, error);
        errors.push(
          `Failed to migrate ${userData.email}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    logger.info("\n📊 ========== MIGRATION SUMMARY ==========");
    logger.info(`✅ Successfully migrated: ${migratedCount} users`);
    logger.info(`⏭️ Skipped (already exist): ${skippedCount} users`);
    logger.info(`❌ Failed: ${errors.length} users`);
    logger.info(
      `⏱️ Total time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`
    );
    logger.info("========================================\n");

    const response = {
      success: true,
      message: `Migration completed. ${migratedCount} users migrated, ${skippedCount} skipped (already exist).`,
      migratedCount,
      skippedCount,
      totalProcessed: users.length,
      errors: errors.length > 0 ? errors : undefined,
    };

    logger.info("🎉 Migration completed successfully!");
    return NextResponse.json(response);
  } catch (error) {
    logger.error("\n💥 ========== MIGRATION ERROR ==========");
    logger.error("Migration failed with error:", error);
    logger.error("======================================\n");

    return NextResponse.json(
      {
        error: "Migration failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// import { NextRequest, NextResponse } from "next/server";
// import { prisma } from "@/lib/server/prisma";
// import { UserStatus, UserRole } from "@/app/generated/prisma/enums";

// interface UserData {
//   email: string;
//   phone: string | null;
//   userName: string;
//   name: string;
//   password: string;
//   balance: number;
//   currency: string;
//   bankAccount: string | null;
//   accountNumber: string | null;
//   bankName: string | null;
//   promoCode: string | null;
//   country: string | null;
//   emailVerified: boolean;
//   phoneVerified: boolean;
//   status: UserStatus;
//   role: UserRole;
//   referralCode?: string;
// }

// const BATCH_SIZE = 1000; // Process 1000 users at a time

// // Generate unique referral code
// function generateReferralCode(email: string, index: number): string {
//   const hash = email
//     .split("")
//     .reduce((acc, char) => acc + char.charCodeAt(0), 0);
//   const uniquePart = `${hash}${index}${Date.now()}`.slice(0, 10);
//   return `REF${uniquePart}`.toUpperCase();
// }

// // Parse SQL INSERT statements (keep your existing function but optimize)
// function parseInsertStatements(sqlContent: string): UserData[] {
//   logger.info("🔍 Starting SQL parsing...");
//   const users: UserData[] = [];
//   let totalRecords = 0;
//   let skippedNoPassword = 0;
//   let skippedNoIdentifier = 0;
//   let autoGeneratedUsernames = 0;
//   let autoGeneratedEmails = 0;
//   let paddedRecords = 0;

//   const insertRegex =
//     /INSERT INTO `users`[^(]*\([^)]+\)\s+VALUES\s*([\s\S]+?);/g;
//   const matches = Array.from(sqlContent.matchAll(insertRegex));

//   logger.info(`✅ Found ${matches.length} INSERT statements`);

//   for (const match of matches) {
//     const valuesSection = match[1];
//     const userRecords = valuesSection.split(/\),\s*\(/);

//     for (let record of userRecords) {
//       totalRecords++;
//       record = record.replace(/^\(/, "").replace(/\)$/, "");

//       const values: string[] = [];
//       let currentValue = "";
//       let inQuote = false;
//       let escapeNext = false;

//       for (let i = 0; i < record.length; i++) {
//         const char = record[i];

//         if (escapeNext) {
//           currentValue += char;
//           escapeNext = false;
//           continue;
//         }

//         if (char === "\\") {
//           escapeNext = true;
//           continue;
//         }

//         if (char === "'" && !escapeNext) {
//           if (inQuote) {
//             if (record[i + 1] === "'") {
//               currentValue += "'";
//               i++;
//             } else {
//               inQuote = false;
//             }
//           } else {
//             inQuote = true;
//           }
//           continue;
//         }

//         if (char === "," && !inQuote) {
//           values.push(currentValue.trim());
//           currentValue = "";
//           continue;
//         }

//         currentValue += char;
//       }

//       if (currentValue) {
//         values.push(currentValue.trim());
//       }

//       if (values.length < 19) {
//         logger.info(
//           `⚠️ Record has insufficient values (${
//             values.length
//           }/19), padding with empty strings: ${JSON.stringify(values)}`
//         );
//         while (values.length < 19) {
//           values.push("");
//         }
//         paddedRecords++;
//       }

//       let userName = values[1]?.trim() || "";
//       let email = values[3]?.trim() || "";
//       const password = values[7]?.trim() || "";

//       if (!password) {
//         logger.info(
//           `⚠️ Skipping record - no password: username="${userName}", email="${email}"`
//         );
//         skippedNoPassword++;
//         continue;
//       }

//       if (!userName && !email) {
//         logger.info(
//           `⚠️ Skipping record - no username or email: ${JSON.stringify(
//             values.slice(0, 5)
//           )}`
//         );
//         skippedNoIdentifier++;
//         continue;
//       }

//       if (!userName) {
//         userName = `user_${Date.now()}_${Math.random()
//           .toString(36)
//           .substring(2, 8)}`;
//         logger.info(
//           `🤖 Auto-generated username: ${userName} for email: ${email}`
//         );
//         autoGeneratedUsernames++;
//       }

//       if (!email) {
//         email = `${userName}@darnumber.com`;
//         logger.info(
//           `📧 Auto-generated email: ${email} for username: ${userName}`
//         );
//         autoGeneratedEmails++;
//       }

//       const userData: UserData = {
//         email,
//         phone: values[2]?.trim() || null,
//         userName,
//         name: userName,
//         password,
//         balance: parseFloat(values[6]?.trim() || "0"),
//         currency: values[14]?.trim() || "NGN",
//         bankAccount: values[9]?.trim() === "YES" ? "YES" : null,
//         accountNumber: values[10]?.trim() || null,
//         bankName: values[11]?.trim() || null,
//         promoCode: values[16]?.trim() || null,
//         country: values[17]?.trim() || null,
//         emailVerified: false,
//         phoneVerified: false,
//         status: UserStatus.ACTIVE,
//         role: UserRole.USER,
//       };

//       logger.info(
//         `👤 Parsed user: ${email} (${userName}) - Balance: ${userData.balance} ${userData.currency}`
//       );
//       users.push(userData);
//     }
//   }

//   logger.info(`✅ Parsing complete.`);
//   logger.info(`📊 Total records processed: ${totalRecords}`);
//   logger.info(`✅ Valid users parsed: ${users.length}`);
//   logger.info(`⚠️ Skipped - no password: ${skippedNoPassword}`);
//   logger.info(`⚠️ Skipped - no identifier: ${skippedNoIdentifier}`);
//   logger.info(`🤖 Auto-generated usernames: ${autoGeneratedUsernames}`);
//   logger.info(`📧 Auto-generated emails: ${autoGeneratedEmails}`);
//   logger.info(`🔧 Padded records (insufficient fields): ${paddedRecords}`);

//   return users;
// }

// // Batch insert with conflict handling
// async function migrateBatch(users: UserData[], startIndex: number) {
//   logger.info(
//     `\n🔄 Processing batch starting at index ${startIndex} with ${users.length} users`
//   );

//   const usersWithRefCodes = users.map((user, idx) => ({
//     ...user,
//     referralCode: generateReferralCode(user.email, startIndex + idx),
//   }));

//   try {
//     logger.info(
//       `💾 Attempting batch insert for ${usersWithRefCodes.length} users...`
//     );
//     // Use createMany with skipDuplicates for much faster insertion
//     const result = await prisma.user.createMany({
//       data: usersWithRefCodes,
//       skipDuplicates: true, // Skip existing emails automatically
//     });

//     logger.info(
//       `✅ Batch insert successful: ${result.count} inserted, ${
//         users.length - result.count
//       } skipped (duplicates)`
//     );
//     return {
//       success: true,
//       count: result.count,
//       skipped: users.length - result.count,
//     };
//   } catch (error) {
//     logger.error(`❌ Batch insert failed:`, error);
//     logger.info(`🔄 Falling back to individual inserts...`);

//     // Fallback: Try individual inserts for this batch
//     let migratedCount = 0;
//     let skippedCount = 0;

//     for (const user of usersWithRefCodes) {
//       try {
//         logger.info(`🔍 Checking/creating user: ${user.email}`);
//         await prisma.user.create({ data: user });
//         logger.info(`✅ Created user: ${user.email}`);
//         migratedCount++;
//       } catch (err) {
//         // Skip if duplicate
//         if (
//           err instanceof Error &&
//           "code" in err &&
//           (err as { code: string }).code === "P2002"
//         ) {
//           logger.info(`⏭️ Skipped duplicate: ${user.email}`);
//           skippedCount++;
//         } else {
//           logger.error(`❌ Failed to migrate ${user.email}:`, err);
//         }
//       }
//     }

//     logger.info(
//       `🔄 Fallback complete: ${migratedCount} inserted, ${skippedCount} skipped`
//     );
//     return {
//       success: true,
//       count: migratedCount,
//       skipped: skippedCount,
//     };
//   }
// }

// export async function POST(request: NextRequest) {
//   logger.info("\n🚀 ========== MIGRATION REQUEST STARTED ==========");
//   const startTime = Date.now();

//   try {
//     const formData = await request.formData();
//     const file = formData.get("file") as File;
//     const batchNumber = parseInt(formData.get("batch")?.toString() || "0");
//     const offset = parseInt(formData.get("offset")?.toString() || "0");

//     if (!file) {
//       return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
//     }

//     logger.info(
//       `📁 File received: ${file.name} (Batch: ${batchNumber}, Offset: ${offset})`
//     );

//     const content = await file.text();
//     const allUsers = parseInsertStatements(content);

//     if (allUsers.length === 0) {
//       return NextResponse.json(
//         { error: "No valid user data found" },
//         { status: 400 }
//       );
//     }

//     // Process only a batch of users
//     const usersToProcess = allUsers.slice(offset, offset + BATCH_SIZE);
//     const hasMore = offset + BATCH_SIZE < allUsers.length;

//     logger.info(
//       `💾 Processing batch ${batchNumber}: ${
//         usersToProcess.length
//       } users (${offset} to ${offset + usersToProcess.length})`
//     );

//     // Migrate this batch
//     const result = await migrateBatch(usersToProcess, offset);

//     const elapsedTime = (Date.now() - startTime) / 1000;

//     logger.info(`\n📊 Batch ${batchNumber} Summary:`);
//     logger.info(`✅ Migrated: ${result.count} users`);
//     logger.info(`⏭️ Skipped: ${result.skipped} users`);
//     logger.info(`⏱️ Time: ${elapsedTime.toFixed(2)}s`);

//     if (!hasMore) {
//       logger.info(`\n🎉 ========== MIGRATION COMPLETED ==========`);
//       logger.info(`📊 Final Summary:`);
//       logger.info(`✅ Total users in file: ${allUsers.length}`);
//       logger.info(`✅ Total processed: ${offset + usersToProcess.length}`);
//       logger.info(`🎯 Migration successful!`);
//       logger.info(`==========================================\n`);
//     }

//     return NextResponse.json({
//       success: true,
//       message: `Batch ${batchNumber} completed${
//         !hasMore ? " - Migration Complete!" : ""
//       }`,
//       migratedCount: result.count,
//       skippedCount: result.skipped,
//       totalUsers: allUsers.length,
//       processedSoFar: offset + usersToProcess.length,
//       hasMore,
//       nextOffset: offset + BATCH_SIZE,
//       batchNumber: batchNumber + 1,
//       progress: (
//         ((offset + usersToProcess.length) / allUsers.length) *
//         100
//       ).toFixed(1),
//     });
//   } catch (error) {
//     logger.error("\n💥 Migration Error:", error);
//     return NextResponse.json(
//       {
//         error: "Migration failed",
//         details: error instanceof Error ? error.message : "Unknown error",
//       },
//       { status: 500 }
//     );
//   }
// }
