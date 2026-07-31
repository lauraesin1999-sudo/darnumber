"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export default function WalletPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [dva, setDva] = useState<{
    bankName: string;
    accountNumber: string;
    accountName: string;
  } | null>(null);
  const [dvaError, setDvaError] = useState("");
  const [dvaCooldownUntil, setDvaCooldownUntil] = useState<number>(0);
  const [dvaProvisioning, setDvaProvisioning] = useState(false);
  const cooldownMs = 15_000; // 15 seconds

  useEffect(() => {
    fetchWalletData();
  }, []);

  const fetchWalletData = async () => {
    try {
      const [balanceRes, transactionsRes] = await Promise.all([
        api.getBalance(),
        api.getTransactions(1, 5),
      ]);
      setBalance(balanceRes.data.balance);
      setTransactions(transactionsRes.data);

      // Try fetch existing DVA without creating
      try {
        const res = await fetch("/api/payments/paystack/dedicated-account", {
          method: "GET",
        });
        const json = await res.json();
        const data = json?.data;
        if (data?.bankName && data?.accountNumber && data?.accountName) {
          setDva(data);
          setDvaProvisioning(false);
        } else if (json?.data?.status === "PENDING") {
          setDvaProvisioning(true);
        }
      } catch (e: any) {
        const msg =
          e?.response?.data?.error?.message ||
          e?.response?.data?.error ||
          e?.message ||
          "";
        if (msg.includes("Paystack secret not configured")) {
          setDvaError(
            "To enable a dedicated account, set PAYSTACK_SECRET_KEY in .env and restart the server."
          );
        }
      }
    } catch (error: any) {
      console.error("Failed to fetch wallet data:", error);
      if (error.response?.status === 401) {
        toast.auth.sessionExpired();
        router.push("/login");
      } else {
        toast.error("Failed to load wallet data", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = () => {
    router.push("/wallet/checkout");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-4 md:space-y-6">
        <h1 className="text-2xl md:text-3xl font-bold">Wallet</h1>

        {/* Balance Card */}
        <Card className="p-4 md:p-6 bg-gradient-to-r from-green-500 to-green-600 text-white">
          <p className="text-xs md:text-sm opacity-90">Available Balance</p>
          <p className="text-3xl md:text-5xl font-bold mt-2">
            ₦{balance.toLocaleString()}
          </p>
        </Card>

        {error && <p className="text-sm md:text-base text-red-800">{error}</p>}

        {/* Fund Wallet */}
        <Card className="p-4 md:p-6">
          <h2 className="text-lg md:text-xl font-bold mb-4">
            Fund Your Wallet
          </h2>
          <p className="text-sm md:text-base text-muted-foreground mb-6">
            Add money to your wallet using Paystack, Flutterwave, or Etegram.
            Fast, secure, and convenient Nigerian payment methods.
          </p>
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-3 md:p-4">
              <h3 className="text-sm md:text-base font-semibold mb-2">
                ✨ Available Payment Methods
              </h3>
              <ul className="text-xs md:text-sm space-y-1 text-muted-foreground">
                <li>• Card Payments (Mastercard, Visa, Verve)</li>
                <li>• Bank Transfer</li>
                <li>• USSD</li>
                <li>• Mobile Money</li>
              </ul>
            </div>
            <Button onClick={handleDeposit} className="w-full" size="lg">
              Fund Wallet
            </Button>
          </div>
        </Card>

        {/* Dedicated Virtual Account */}
        <Card className="p-4 md:p-6 space-y-3">
          <h2 className="text-lg md:text-xl font-bold">
          Dedicated Account Number
          </h2>
          {dvaError && (
            <p className="text-sm md:text-base text-red-800">{dvaError}</p>
          )}
          {!dva && !dvaError && !dvaProvisioning && (
            <p className="text-sm md:text-base text-muted-foreground">
              {/* No dedicated account yet. Generate one from the checkout page or
              here. */}
             <span className="text-amber-700">Effective immediately, deposits into dedicated virtual accounts will no longer be processed. </span> 
             We are currently working to bring back this service.
             
            </p>
          )}
          {/* {dva && (
            <div className="border rounded-lg p-3 md:p-4 text-xs md:text-sm space-y-2">
              <div className="font-medium">{dva.bankName}</div>
              <div>Account Name: {dva.accountName}</div>
              <div className="font-mono">
                Account Number: {dva.accountNumber}
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(dva.accountNumber);
                    toast.copy.success("Account number");
                  }}
                >
                  Copy Account Number
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${dva.accountName} - ${dva.bankName}`
                    );
                    toast.copy.success("Account details");
                  }}
                >
                  Copy Account Details
                </Button>
              </div>
            </div>
          )} */}
          {dvaProvisioning && (
            <p className="text-sm md:text-base text-green-600">
              Your dedicated account is being provisioned. This can take a few
              minutes. We will refresh details automatically.
            </p>
          )}
          <div className="flex gap-2">
            {/* <Button
              disabled={true}
              variant="secondary"
              // onClick={async () => {
              //   setDvaError("");
              //   const now = Date.now();
              //   if (now < dvaCooldownUntil) {
              //     setDvaError(
              //       `Please wait ${Math.ceil(
              //         (dvaCooldownUntil - now) / 1000
              //       )}s before requesting again.`
              //     );
              //     return;
              //   }
              //   setDvaCooldownUntil(now + cooldownMs);
              //   try {
              //     const res = await fetch(
              //       "/api/payments/paystack/dedicated-account",
              //       {
              //         method: "POST",
              //         headers: { "Content-Type": "application/json" },
              //         body: JSON.stringify({ preferredBank: "wema-bank" }),
              //       }
              //     );
              //     const json = await res.json();
              //     if (!res.ok) {
              //       throw new Error(
              //         json?.error?.message ||
              //           json?.error ||
              //           "Failed to request dedicated account"
              //       );
              //     }
              //     const data = json?.data;
              //     if ((data as any)?.status === "PENDING") {
              //       setDvaProvisioning(true);
              //       // Begin polling GET every 20s until details exist
              //       const interval = setInterval(async () => {
              //         try {
              //           const getRes = await fetch(
              //             "/api/payments/paystack/dedicated-account",
              //             {
              //               method: "GET",
              //             }
              //           );
              //           const getJson = await getRes.json();
              //           const got = getJson?.data;
              //           if (
              //             got?.bankName &&
              //             got?.accountNumber &&
              //             got?.accountName
              //           ) {
              //             setDva(got);
              //             setDvaProvisioning(false);
              //             clearInterval(interval);
              //           }
              //         } catch {}
              //       }, 20000);
              //     } else {
              //       if (
              //         !data?.bankName ||
              //         !data?.accountNumber ||
              //         !data?.accountName
              //       ) {
              //         setDvaError(
              //           "Missing account details from provider. Please try again or contact support."
              //         );
              //         return;
              //       }
              //       setDva(data);
              //     }
              //   } catch (e: any) {
              //     const msg =
              //       e?.response?.data?.error?.message ||
              //       e?.response?.data?.error ||
              //       e?.message ||
              //       "Failed to request dedicated account";
              //     if (msg.includes("Paystack secret not configured")) {
              //       setDvaError(
              //         "Paystack secret not configured. Please set PAYSTACK_SECRET_KEY in .env and restart the server."
              //       );
              //     } else {
              //       setDvaError(msg);
              //     }
              //   } finally {
              //     setTimeout(() => setDvaCooldownUntil(0), cooldownMs);
              //   }
              // }}
            >
              {dva ? "Regenerate Account" : "Generate Dedicated Account"}
            </Button> */}
            <Button variant="outline" onClick={handleDeposit}>
              Fund via Checkout
            </Button>
          </div>
        </Card>

        {/* Transaction History */}
        <Card className="p-4 md:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg md:text-xl font-bold">
              Recent Transactions
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/transactions")}
            >
              View All
            </Button>
          </div>
          <div className="space-y-2">
            {transactions.length === 0 ? (
              <p className="text-center text-muted-foreground py-4 text-sm md:text-base">
                No transactions yet
              </p>
            ) : (
              transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 md:p-4 border rounded-lg gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-sm md:text-base truncate">
                      {tx.type}
                    </p>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      {new Date(tx.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end sm:text-right gap-4">
                    <p
                      className={`font-bold text-sm md:text-base ${
                        tx.type === "DEPOSIT" || tx.type === "REFUND"
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {tx.type === "DEPOSIT" || tx.type === "REFUND"
                        ? "+"
                        : "-"}
                      ₦{Number(tx.amount).toLocaleString()}
                    </p>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      {tx.status}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
