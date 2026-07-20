import { prisma } from "@/lib/server/prisma";
import { RedisService } from "@/lib/server/services/redis.service";

const redis = new RedisService();

export class PaymentService {
  async initializePayment(input: {
    userId: string;
    amount: number;
    provider: "etegram" | "paystack" | "flutterwave";
  }) {
    const { userId, amount, provider } = input;
    if (amount <= 0) throw new Error("Invalid amount");

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, userName: true, phone: true, currency: true },
    });
    if (!user) throw new Error("User not found");

    console.log(
      "[Payments][Initialize]",
      "userId=",
      userId,
      "provider=",
      provider,
      "amount=",
      amount,
      "currency=",
      user.currency,
    );

    if (provider === "etegram") {
      const projectId = process.env.ETEGRAM_PROJECT_ID;
      const publicKey = process.env.ETEGRAM_PUBLIC_KEY;
      if (!projectId || !publicKey)
        throw new Error(
          "Etegram credentials not configured. Please set ETEGRAM_PROJECT_ID and ETEGRAM_PUBLIC_KEY in .env",
        );

      const reference = `ETG-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      const initUrl = `https://api-checkout.etegram.com/api/transaction/initialize/${projectId}`;
      console.log(
        "[Payments][Etegram][Init]",
        "ref=",
        reference,
        "initUrl=",
        initUrl,
        "email=",
        user.email,
      );
      const res = await fetch(initUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${publicKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: Math.round(Number(amount)),
          email: user.email,
          phone: user.phone || undefined,
          firstname: user.userName || undefined,
          lastname: undefined,
          reference,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Failed to initialize Etegram payment${errText ? ": " + errText : ""}`,
        );
      }
      const data = (await res.json()) as any;
      const authUrl = data?.data?.authorization_url;
      const accessCode = data?.data?.access_code;
      const ref = data?.data?.reference || reference;
      if (!authUrl || !accessCode)
        throw new Error("Invalid Etegram init response");

      await prisma.transaction.create({
        data: {
          userId,
          transactionNumber: `DEP-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}`,
          type: "DEPOSIT",
          amount: Math.round(Number(amount)),
          currency: "NGN",
          balanceBefore: 0 as any,
          balanceAfter: 0 as any,
          status: "PENDING",
          description: "Deposit via Etegram",
          paymentMethod: "etegram",
          referenceId: ref,
          paymentDetails: { accessCode, authorizationUrl: authUrl },
        },
      });
      console.log(
        "[Payments][Etegram][Txn] Created pending deposit",
        "ref=",
        ref,
        "accessCode=",
        accessCode,
      );
      return { authorizationUrl: authUrl, reference: ref };
    }

    if (provider === "paystack") {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret)
        throw new Error(
          "Paystack secret not configured. Please set PAYSTACK_SECRET_KEY in .env",
        );

      const reference = `PST-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      console.log(
        "[Payments][Paystack][Init]",
        "ref=",
        reference,
        "email=",
        user.email,
        "amount(kobo)=",
        Math.round(Number(amount) * 100),
      );

      const res = await fetch(
        "https://api.paystack.co/transaction/initialize",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: Math.round(Number(amount) * 100),
            email: user.email,
            currency: "NGN",
            reference,
          }),
        },
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Failed to initialize Paystack payment${
            errText ? ": " + errText : ""
          }`,
        );
      }
      const data = (await res.json()) as any;
      const authUrl = data?.data?.authorization_url;
      const ref = data?.data?.reference || reference;
      if (!authUrl || !ref) throw new Error("Invalid Paystack init response");

      await prisma.transaction.create({
        data: {
          userId,
          transactionNumber: `DEP-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}`,
          type: "DEPOSIT",
          amount: Math.round(Number(amount)),
          currency: "NGN",
          balanceBefore: 0 as any,
          balanceAfter: 0 as any,
          status: "PENDING",
          description: "Deposit via Paystack",
          paymentMethod: "paystack",
          referenceId: ref,
          paymentDetails: { authorizationUrl: authUrl },
        },
      });
      console.log(
        "[Payments][Paystack][Txn] Created pending deposit",
        "ref=",
        ref,
      );
      return { authorizationUrl: authUrl, reference: ref };
    }

    if (provider === "flutterwave") {
      const secret = process.env.FLUTTERWAVE_SECRET_KEY;
      if (!secret)
        throw new Error(
          "Flutterwave secret not configured. Please set FLUTTERWAVE_SECRET_KEY in .env",
        );

      if (!process.env.NEXTAUTH_URL) {
        throw new Error(
          "Missing NEXTAUTH_URL for Flutterwave redirect. Set NEXTAUTH_URL (e.g., https://darnumber.com).",
        );
      }

      const reference = `FLW-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      console.log(
        "[Payments][Flutterwave][Init]",
        "ref=",
        reference,
        "email=",
        user.email,
        "amount=",
        Math.round(Number(amount)),
      );

      const body = {
        tx_ref: reference,
        amount: Math.round(Number(amount)),
        currency: "NGN",
        redirect_url: `${
          process.env.NEXTAUTH_URL || ""
        }/wallet/verify?ref=${reference}&provider=flutterwave`,
        customer: {
          email: user.email,
          phonenumber: user.phone,
          name: user.userName,
        },
        customizations: { title: "Wallet Top-up", description: "Fund wallet" },
      };

      const res = await fetch("https://api.flutterwave.com/v3/payments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Failed to initialize Flutterwave${errText ? ": " + errText : ""}`,
        );
      }
      const data = (await res.json()) as any;
      const link = data?.data?.link;
      if (!link) throw new Error("Invalid Flutterwave init response");

      await prisma.transaction.create({
        data: {
          userId,
          transactionNumber: `DEP-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}`,
          type: "DEPOSIT",
          amount: Math.round(Number(amount)),
          currency: "NGN",
          balanceBefore: 0 as any,
          balanceAfter: 0 as any,
          status: "PENDING",
          description: "Deposit via Flutterwave",
          paymentMethod: "flutterwave",
          referenceId: reference,
          paymentDetails: { link },
        },
      });
      console.log(
        "[Payments][Flutterwave][Txn] Created pending deposit",
        "ref=",
        reference,
      );
      return { authorizationUrl: link, reference };
    }

    throw new Error("Payment provider not implemented");
  }

  async verifyPayment(input: {
    userId: string;
    reference: string;
    provider: "etegram" | "paystack" | "flutterwave";
  }) {
    const { userId, reference, provider } = input;
    console.log(
      "[Payments][Verify]",
      "userId=",
      userId,
      "provider=",
      provider,
      "reference=",
      reference,
    );
    const txn = await prisma.transaction.findFirst({
      where: {
        userId,
        type: "DEPOSIT",
        referenceId: reference,
        status: "PENDING",
      },
    });
    if (!txn) throw new Error("Pending transaction not found");

    if (provider === "paystack") {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret)
        throw new Error(
          "Paystack secret not configured. Please set PAYSTACK_SECRET_KEY in .env",
        );
      const verifyUrl = `https://api.paystack.co/transaction/verify/${reference}`;
      console.log("[Payments][Verify][Paystack] verifyUrl=", verifyUrl);
      const res = await fetch(verifyUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        let errorMsg = "Failed to verify Paystack payment";
        try {
          const errJson = JSON.parse(errText);
          errorMsg = errJson?.message || errorMsg;
          console.error("[Payments][Verify][Paystack] API Error:", errJson);
        } catch {
          console.error("[Payments][Verify][Paystack] Error:", errText);
        }
        throw new Error(errorMsg);
      }
      const data = (await res.json()) as any;
      const status = data?.data?.status?.toLowerCase();
      const paid = status === "success";
      const amountPaid = Number(data?.data?.amount ?? 0) / 100;
      console.log(
        "[Payments][Verify][Paystack]",
        "status=",
        status,
        "paid=",
        paid,
        "amountPaid=",
        amountPaid,
      );

      if (!paid)
        return { success: false, status: data?.data?.status || "failed" };

      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { balance: true, currency: true },
        });
        if (!user) throw new Error("User not found");
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: amountPaid } },
        });
        await tx.transaction.update({
          where: { id: txn.id },
          data: {
            status: "COMPLETED",
            balanceBefore: user.balance,
            balanceAfter: Number(user.balance) + amountPaid,
          },
        });
        await tx.activityLog.create({
          data: {
            userId,
            action: "DEPOSIT_COMPLETED",
            resource: "transaction",
            resourceId: txn.id,
            metadata: { provider, reference, amount: amountPaid },
          },
        });
      });
      console.log(
        "[Payments][Verify][Paystack] Deposit completed",
        "userId=",
        userId,
        "reference=",
        reference,
        "amount=",
        amountPaid,
      );
      // Fire-and-forget: cache bust is best-effort — the DB is already committed
      redis.invalidateUserBalance(userId).catch(() => {});
      return {
        success: true,
        status: "success",
        amount: amountPaid,
        reference,
      };
    }

    if (provider === "flutterwave") {
      const secret = process.env.FLUTTERWAVE_SECRET_KEY;
      if (!secret)
        throw new Error(
          "Flutterwave secret not configured. Please set FLUTTERWAVE_SECRET_KEY in .env",
        );
      const verifyUrl = `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${reference}`;
      console.log("[Payments][Verify][Flutterwave] verifyUrl=", verifyUrl);
      const res = await fetch(verifyUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `Failed to verify Flutterwave payment${errText ? ": " + errText : ""}`,
        );
      }
      const data = (await res.json()) as any;
      const status = (data?.data?.status || "").toString().toLowerCase();
      const paid = status === "successful" || status === "success";
      const amountPaid = Number(data?.data?.amount ?? txn.amount);
      console.log(
        "[Payments][Verify][Flutterwave]",
        "status=",
        status,
        "paid=",
        paid,
        "amountPaid=",
        amountPaid,
      );

      if (!paid)
        return { success: false, status: data?.data?.status || "failed" };

      await prisma.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { balance: true, currency: true },
        });
        if (!user) throw new Error("User not found");
        await tx.user.update({
          where: { id: userId },
          data: { balance: { increment: amountPaid } },
        });
        await tx.transaction.update({
          where: { id: txn.id },
          data: {
            status: "COMPLETED",
            balanceBefore: user.balance,
            balanceAfter: Number(user.balance) + amountPaid,
          },
        });
        await tx.activityLog.create({
          data: {
            userId,
            action: "DEPOSIT_COMPLETED",
            resource: "transaction",
            resourceId: txn.id,
            metadata: { provider, reference, amount: amountPaid },
          },
        });
      });
      console.log(
        "[Payments][Verify][Flutterwave] Deposit completed",
        "userId=",
        userId,
        "reference=",
        reference,
        "amount=",
        amountPaid,
      );
      // Fire-and-forget: cache bust is best-effort — the DB is already committed
      redis.invalidateUserBalance(userId).catch(() => {});
      return {
        success: true,
        status: "success",
        amount: amountPaid,
        reference,
      };
    }

    if (provider === "etegram") {
      const projectId = process.env.ETEGRAM_PROJECT_ID;
      const publicKey = process.env.ETEGRAM_PUBLIC_KEY;
      if (!projectId || !publicKey)
        throw new Error(
          "Etegram credentials not configured. Please set ETEGRAM_PROJECT_ID and ETEGRAM_PUBLIC_KEY in .env",
        );
      const accessCode = (txn.paymentDetails as any)?.accessCode;

      // Etegram uses webhook for verification, so return pending status
      return {
        success: false,
        status: "PENDING",
        message: "Awaiting Etegram webhook confirmation",
      };
    }

    throw new Error("Payment provider not implemented");
  }
  async requestWithdrawal(userId: string, amount: number, bankDetails: any) {
    console.log(
      "[Payments][Withdrawal] Request submitted",
      "userId=",
      userId,
      "amount=",
      amount,
    );
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");
    if (Number(user.balance) < amount) throw new Error("Insufficient balance");
    if (amount < 10) throw new Error("Minimum withdrawal amount is $10");

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { balance: { decrement: amount } },
      });
      await tx.transaction.create({
        data: {
          userId,
          transactionNumber: `WD-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}`,
          type: "WITHDRAWAL",
          amount,
          currency: user.currency,
          balanceBefore: user.balance,
          balanceAfter: Number(user.balance) - amount,
          status: "PENDING",
          description: "Withdrawal to bank account",
          paymentMethod: "bank_transfer",
          paymentDetails: bankDetails,
        },
      });
    });

    // Fire-and-forget: cache bust is best-effort — the DB is already committed
    redis.invalidateUserBalance(userId).catch(() => {});
    return {
      message:
        "Withdrawal request submitted. Processing time: 1-3 business days",
    };
  }

  private async completeDeposit(
    userId: string,
    transactionId: string,
    amount: number,
    meta: Record<string, unknown>,
  ) {
    console.log(
      "[Payments][Deposit] Completing",
      "userId=",
      userId,
      "transactionId=",
      transactionId,
      "amount=",
      amount,
      "meta=",
      meta,
    );
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { balance: true },
      });
      if (!user) throw new Error("User not found");
      await tx.user.update({
        where: { id: userId },
        data: { balance: { increment: amount } },
      });
      await tx.transaction.update({
        where: { id: transactionId },
        data: {
          status: "COMPLETED",
          balanceBefore: user.balance,
          balanceAfter: Number(user.balance) + amount,
        },
      });
      await tx.activityLog.create({
        data: {
          userId,
          action: "DEPOSIT_COMPLETED",
          resource: "transaction",
          resourceId: transactionId,
          metadata: meta as any,
        },
      });
    });
    // Fire-and-forget: cache bust is best-effort — the DB is already committed
    redis.invalidateUserBalance(userId).catch(() => {});
    console.log(
      "[Payments][Deposit] Completed",
      "userId=",
      userId,
      "transactionId=",
      transactionId,
      "amount=",
      amount,
    );
  }

  async handleEtegramWebhook(payload: any) {
    console.log("[Webhook][Etegram] Received", {
      reference: payload?.reference || payload?.data?.reference,
      status: payload?.status || payload?.data?.status,
      amount: payload?.amount ?? payload?.data?.amount,
    });

    const reference: string | undefined =
      payload?.reference || payload?.data?.reference;
    const status = (payload?.status || payload?.data?.status || "")
      .toString()
      .toLowerCase();
    const amount = Number(payload?.amount ?? payload?.data?.amount ?? 0);

    if (!reference) {
      console.log("[Webhook][Etegram] No reference found, skipping");
      return { ok: false };
    }

    // Only process successful payments
    if (!(status === "successful" || status === "success")) {
      console.log("[Webhook][Etegram] Payment not successful, status:", status);
      return { ok: false };
    }

    console.log(
      "[Webhook][Etegram] Processing successful payment:",
      "ref=",
      reference,
      "amount=",
      amount,
    );

    // Check for existing transaction
    const existingTxn = await prisma.transaction.findFirst({
      where: { referenceId: reference },
    });

    if (existingTxn) {
      // Transaction exists - check if it's pending
      if (existingTxn.status === "PENDING") {
        console.log(
          "[Webhook][Etegram] Found pending transaction, completing it:",
          existingTxn.id,
        );
        await this.completeDeposit(existingTxn.userId, existingTxn.id, amount, {
          provider: "etegram",
          reference,
        });
        console.log(
          "[Webhook][Etegram] Deposit completed for user:",
          existingTxn.userId,
        );
      } else {
        console.log(
          "[Webhook][Etegram] Transaction already processed with status:",
          existingTxn.status,
        );
      }
      return { ok: true };
    }

    // Transaction doesn't exist - create new one if we have customer email
    const customerEmail =
      payload?.data?.customer?.email || payload?.customer?.email || null;

    if (!customerEmail) {
      console.log(
        "[Webhook][Etegram] No existing transaction and no customer email; skipping",
      );
      return { ok: true };
    }

    const user = await prisma.user.findUnique({
      where: { email: customerEmail },
      select: { id: true },
    });

    if (!user) {
      console.log(
        "[Webhook][Etegram] User not found for email:",
        customerEmail,
      );
      return { ok: true };
    }

    const transactionNumber = `ETG-WH-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 9)}`;

    console.log(
      "[Webhook][Etegram] Creating new transaction for user:",
      user.id,
    );

    const newTxn = await prisma.transaction.create({
      data: {
        userId: user.id,
        transactionNumber,
        type: "DEPOSIT",
        amount: amount,
        currency: "NGN",
        balanceBefore: 0 as any,
        balanceAfter: 0 as any,
        status: "PENDING",
        description: "Deposit via Etegram",
        paymentMethod: "etegram",
        referenceId: reference,
        paymentDetails: { customerEmail },
      },
    });

    await this.completeDeposit(user.id, newTxn.id, amount, {
      provider: "etegram",
      reference,
      type: "webhook",
    });

    console.log(
      "[Webhook][Etegram] New deposit completed",
      "userId=",
      user.id,
      "txn=",
      newTxn.id,
    );

    return { ok: true };
  }

  async handlePaystackWebhook(rawBody: string, signature: string | null) {
    console.log(
      "[Webhook][Paystack] Received",
      "signaturePresent=",
      !!signature,
      "rawLen=",
      (rawBody || "").length,
    );
    // Signature validation intentionally disabled.

    const event = JSON.parse(rawBody);
    console.log(
      "[Paystack Webhook] Event:",
      event?.event,
      "Data:",
      JSON.stringify(event?.data || {}).substring(0, 200),
    );

    // Handle charge success events
    if (event?.event === "charge.success") {
      const ref = event?.data?.reference;
      const amount = Number(event?.data?.amount ?? 0) / 100;
      const customerEmail = event?.data?.customer?.email;
      const channel = event?.data?.channel;

      if (!ref) {
        console.log("[Paystack Webhook] No reference found, skipping");
        return { ok: true, status: 200 };
      }

      console.log(
        "[Paystack Webhook] Processing charge.success:",
        "ref=",
        ref,
        "amount=",
        amount,
        "email=",
        customerEmail,
        "channel=",
        channel,
      );

      // Check if we already processed this reference
      const existingTxn = await prisma.transaction.findFirst({
        where: { referenceId: ref },
      });

      if (existingTxn) {
        // Transaction exists - check if it's pending
        if (existingTxn.status === "PENDING") {
          console.log(
            "[Paystack Webhook] Found pending transaction, completing it:",
            existingTxn.id,
          );
          await this.completeDeposit(
            existingTxn.userId,
            existingTxn.id,
            amount,
            {
              provider: "paystack",
              reference: ref,
              channel: channel,
            },
          );
          console.log(
            "[Paystack Webhook] Deposit completed for user:",
            existingTxn.userId,
          );
        } else {
          console.log(
            "[Paystack Webhook] Transaction already processed with status:",
            existingTxn.status,
          );
        }
        return { ok: true, status: 200 };
      }

      // Transaction doesn't exist - create new one if we have customer email
      if (customerEmail) {
        console.log(
          "[Paystack Webhook] No existing transaction, creating new one for:",
          customerEmail,
        );

        const user = await prisma.user.findUnique({
          where: { email: customerEmail },
        });

        if (user) {
          const transactionNumber = `PST-WH-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 9)}`;

          console.log(
            "[Paystack Webhook] Creating new transaction for user:",
            user.id,
          );

          const newTxn = await prisma.transaction.create({
            data: {
              userId: user.id,
              transactionNumber,
              type: "DEPOSIT",
              amount: amount,
              currency: "NGN",
              balanceBefore: 0 as any,
              balanceAfter: 0 as any,
              status: "PENDING",
              description:
                channel === "dedicated_nuban"
                  ? "Deposit via Paystack Virtual Account"
                  : "Deposit via Paystack",
              paymentMethod: "paystack",
              referenceId: ref,
              paymentDetails: {
                customerEmail,
                channel,
                paidAt: event?.data?.paid_at,
              },
            },
          });

          await this.completeDeposit(user.id, newTxn.id, amount, {
            provider: "paystack",
            reference: ref,
            type: channel === "dedicated_nuban" ? "dva" : "card",
            channel,
          });

          console.log(
            "[Paystack Webhook] New deposit completed for user:",
            user.id,
            "txn:",
            newTxn.id,
          );
        } else {
          console.log(
            "[Paystack Webhook] User not found for email:",
            customerEmail,
          );
        }
      } else {
        console.log(
          "[Paystack Webhook] No customer email found, cannot create transaction",
        );
      }
    }

    return { ok: true, status: 200 };
  }

  async handleFlutterwaveWebhook(rawBody: string, signature: string | null) {
    console.log(
      "[Webhook][Flutterwave] Received",
      "signaturePresent=",
      !!signature,
      "rawLen=",
      (rawBody || "").length,
    );
    // Signature validation intentionally disabled.
    const event = JSON.parse(rawBody);
    const status = (event?.data?.status || "").toString().toLowerCase();
    console.log("[Webhook][Flutterwave] Event status=", status);

    if (status === "successful" || status === "success") {
      const ref = event?.data?.tx_ref;
      const amount = Number(event?.data?.amount ?? 0);
      const customerEmail = event?.data?.customer?.email || null;

      console.log(
        "[Webhook][Flutterwave] Successful payment",
        "ref=",
        ref,
        "amount=",
        amount,
        "customerEmail=",
        customerEmail,
      );

      if (!ref) {
        console.log("[Webhook][Flutterwave] No reference found, skipping");
        return { ok: true, status: 200 };
      }

      // Check for existing transaction
      const existingTxn = await prisma.transaction.findFirst({
        where: { referenceId: ref },
      });

      if (existingTxn) {
        // Transaction exists - check if it's pending
        if (existingTxn.status === "PENDING") {
          console.log(
            "[Webhook][Flutterwave] Found pending transaction, completing it:",
            existingTxn.id,
          );
          await this.completeDeposit(
            existingTxn.userId,
            existingTxn.id,
            amount,
            {
              provider: "flutterwave",
              reference: ref,
            },
          );
          console.log(
            "[Webhook][Flutterwave] Deposit completed for user:",
            existingTxn.userId,
          );
        } else {
          console.log(
            "[Webhook][Flutterwave] Transaction already processed with status:",
            existingTxn.status,
          );
        }
        return { ok: true, status: 200 };
      }

      // Transaction doesn't exist - create new one if we have customer email
      if (!customerEmail) {
        console.log(
          "[Webhook][Flutterwave] No existing transaction and no customer email; skipping",
        );
        return { ok: true, status: 200 };
      }

      const user = await prisma.user.findUnique({
        where: { email: customerEmail },
        select: { id: true },
      });

      if (!user) {
        console.log(
          "[Webhook][Flutterwave] User not found for email:",
          customerEmail,
        );
        return { ok: true, status: 200 };
      }

      const transactionNumber = `FLW-WH-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 9)}`;

      console.log(
        "[Webhook][Flutterwave] Creating new transaction for user:",
        user.id,
      );

      const newTxn = await prisma.transaction.create({
        data: {
          userId: user.id,
          transactionNumber,
          type: "DEPOSIT",
          amount: amount,
          currency: "NGN",
          balanceBefore: 0 as any,
          balanceAfter: 0 as any,
          status: "PENDING",
          description: "Deposit via Flutterwave",
          paymentMethod: "flutterwave",
          referenceId: ref,
          paymentDetails: { customerEmail },
        },
      });

      await this.completeDeposit(user.id, newTxn.id, amount, {
        provider: "flutterwave",
        reference: ref,
        type: "webhook",
      });

      console.log(
        "[Webhook][Flutterwave] New deposit completed",
        "userId=",
        user.id,
        "txn=",
        newTxn.id,
      );
    }

    return { ok: true, status: 200 };
  }

  async requestPaystackDedicatedAccount(
    userId: string,
    preferredBank?: string,
  ) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new Error("Paystack secret not configured");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");
    if (!user.email)
      throw new Error(
        "User missing email. A Paystack customer requires an email address.",
      );
    console.log(
      "[DVA][Service] user=",
      userId,
      "preferredBank=",
      preferredBank,
      "currency=",
      user.currency,
    );
    // Try to find an existing Paystack customer by email via listing
    let customerCode: string | undefined;
    try {
      const listRes = await fetch(
        `https://api.paystack.co/customer?perPage=50&page=1`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${secret}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (listRes.ok) {
        const listJson = (await listRes.json()) as any;
        const match = Array.isArray(listJson?.data)
          ? listJson.data.find(
              (c: any) =>
                (c?.email || "").toLowerCase() === user.email.toLowerCase(),
            )
          : undefined;
        if (match?.customer_code) customerCode = match.customer_code;
        console.log("[DVA][Service] matchedCustomer=", match?.customer_code);
      }
    } catch {}

    // If not found, create a new customer
    if (!customerCode) {
      const custRes = await fetch("https://api.paystack.co/customer", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: user.email,
          first_name: user.userName,
          phone: user.phone,
        }),
      });
      if (!custRes.ok) {
        const errText = await custRes.text().catch(() => "");
        throw new Error(
          `Failed to create Paystack customer${errText ? ": " + errText : ""}`,
        );
      }
      const cust = (await custRes.json()) as any;
      customerCode = cust?.data?.customer_code;
      console.log("[DVA][Service] createdCustomerCode=", customerCode);
      if (!customerCode) {
        throw new Error(
          "Failed to create Paystack customer: missing customer_code",
        );
      }
    }

    const assignRes = await fetch(
      "https://api.paystack.co/dedicated_account/assign",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer: customerCode,
          preferred_bank: (preferredBank || "wema-bank").toLowerCase(),
          // country and currency can help avoid ambiguous defaults
          country: "NG",
          currency: "NGN",
          // Required customer identity fields for assignment
          first_name: (user.userName || "").split(" ")[0] || "User",
          last_name:
            (user.userName || "").split(" ")[1] ||
            (user.userName ? user.userName : "User"),
          email: user.email,
          phone: user.phone || undefined,
        }),
      },
    );
    if (!assignRes.ok) {
      const errText = await assignRes.text().catch(() => "");
      console.error(
        "[DVA][Service][Assign][ERROR] code=",
        customerCode,
        "resp=",
        errText,
      );
      throw new Error(
        `Failed to assign dedicated account${errText ? ": " + errText : ""}`,
      );
    }
    const assign = (await assignRes.json()) as any;
    const bankName = assign?.data?.bank?.name;
    const accountNumber = assign?.data?.account_number;
    const accountName = assign?.data?.account_name;
    console.log("[DVA][Service] assigned=", {
      bankName,
      accountNumber,
      accountName,
    });
    // Paystack may respond with an in-progress status; surface as pending
    if (!bankName || !accountNumber || !accountName) {
      const msg = (assign?.message || "").toString().toLowerCase();
      if (msg.includes("in progress") || msg.includes("pending")) {
        return {
          status: "PENDING",
          message: assign?.message || "Assign dedicated account in progress",
        } as any;
      }
      throw new Error(
        `Invalid dedicated account response: ${JSON.stringify(assign)}`,
      );
    }

    await prisma.user.update({
      where: { id: userId },
      data: { bankName, accountNumber, bankAccount: accountName },
    });
    await prisma.activityLog.create({
      data: {
        userId,
        action: "DVA_ASSIGNED",
        resource: "user",
        resourceId: userId,
        metadata: { bankName, accountNumber },
      },
    });
    return { bankName, accountNumber, accountName };
  }
  async getPaymentHistory(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId, type: { in: ["DEPOSIT", "WITHDRAWAL"] } },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.transaction.count({
        where: { userId, type: { in: ["DEPOSIT", "WITHDRAWAL"] } },
      }),
    ]);
    return {
      transactions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
  }
}
