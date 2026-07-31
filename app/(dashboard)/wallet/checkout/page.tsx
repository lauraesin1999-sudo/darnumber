"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Provider = "etegram" | "paystack" | "flutterwave";

export default function CheckoutPage() {
  const router = useRouter();
  const [amount, setAmount] = useState<string>("");
  const [provider, setProvider] = useState<Provider>("etegram");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [dva, setDva] = useState<{
    bankName: string;
    accountNumber: string;
    accountName: string;
  } | null>(null);
  const [dvaError, setDvaError] = useState<string>("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amt = Math.round(Number(amount));
    if (!amt || amt < 100) {
      setError("Enter a valid amount (min ₦100)");
      return;
    }
    setLoading(true);
    try {
      const res = await api.initializePayment(amt, provider);
      const url =
        res?.data?.authorizationUrl ||
        res?.data?.authorization_url ||
        res?.data?.link;
      const reference = res?.data?.reference;
      if (!url) throw new Error("Failed to get payment link");
      // For Etegram we rely on webhook; still redirect to the provided authorization URL
      window.location.href = url;
      // Optional: keep reference in URL to support manual verify if needed
      if (provider !== "etegram" && reference) {
        router.push(
          `/wallet/verify?ref=${encodeURIComponent(
            reference
          )}&provider=${provider}`
        );
      }
    } catch (e: any) {
      const errorMsg =
        e?.response?.data?.error?.message ||
        e?.message ||
        "Failed to initialize payment";
      setError(errorMsg);
      toast.payment.failed(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const requestDedicatedAccount = async () => {
    setError("");
    setDvaError("");
    setLoading(true);
    try {
      const res = await fetch("/api/payments/paystack/dedicated-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferredBank: "wema-bank" }),
      });
      const json = await res.json();
      const data = json?.data;
      if ((data as any)?.status === "PENDING") {
        setDvaError(
          "Your dedicated account is being provisioned. We will refresh automatically once available."
        );
        // Try immediate GET to see if already created
        const getRes = await fetch("/api/payments/paystack/dedicated-account", {
          method: "GET",
        });
        const getJson = await getRes.json();
        const got = getJson?.data;
        if (got?.bankName && got?.accountNumber && got?.accountName) {
          setDva(got);
          setDvaError("");
        }
      } else if (data?.bankName && data?.accountNumber && data?.accountName) {
        setDva(data);
      } else {
        setDvaError(
          "Missing account details from provider. Please try again or contact support."
        );
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.error?.message ||
        e?.response?.data?.error ||
        e?.message ||
        "Failed to request dedicated account";
      // Provide actionable guidance for missing env
      if (msg.includes("Paystack secret not configured")) {
        setDvaError(
          "Paystack secret not configured. Please set PAYSTACK_SECRET_KEY in .env and restart the server."
        );
      } else {
        setDvaError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="container mx-auto p-4 md:p-6 max-w-2xl space-y-4 md:space-y-6">
        <h1 className="text-xl md:text-2xl font-bold">Fund Wallet</h1>

        {error && <p className="text-sm md:text-base text-red-700">{error}</p>}

        <Card className="p-4 md:p-6 space-y-4 md:space-y-6">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="amount" className="text-sm md:text-base">
                Amount (NGN)
              </Label>
              <Input
                id="amount"
                type="number"
                min="100"
                step="1"
                placeholder="Minimum ₦100"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                disabled={loading}
                className="text-sm md:text-base"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm md:text-base">Payment Provider</Label>
              <div className="grid grid-cols-1 gap-3">
                {(
                  [
                    { key: "etegram", label: "Etegram " },
                    // { key: "paystack", label: "Paystack" },
                    // { key: "flutterwave", label: "Flutterwave" },
                  ] as { key: Provider; label: string }[]
                ).map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => setProvider(p.key)}
                    className={`border rounded-lg p-3 text-left hover:bg-muted transition-all ${
                      provider === p.key
                        ? "ring-2 ring-primary bg-primary/5"
                        : ""
                    }`}
                    disabled={loading}
                  >
                    <div className="font-medium text-sm md:text-base">
                      {p.label}
                    </div>
                    <div className="text-xs md:text-sm text-muted-foreground mt-1">
                      {p.key === "etegram" &&
                        "Bank transfer checkout via Etegram"}
                      {p.key === "paystack" && "Cards, Bank Transfer, USSD"}
                      {p.key === "flutterwave" && "Cards, Bank, Mobile Money"}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Processing..." : "Proceed to Payment"}
            </Button>
          </form>
        </Card>

        <Card className="p-4 md:p-6 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex-1">
              <h2 className="font-semibold text-sm md:text-base">
                Dedicated Bank Account (Coming Soon)
              </h2>
              <p className="text-xs md:text-sm text-muted-foreground mt-1">
                Request a personal virtual account for easy top-ups.
              </p>
            </div>
            <Button
              disabled
              variant="secondary"
              // onClick={requestDedicatedAccount}
              // disabled={loading}
              className="w-full sm:w-auto whitespace-nowrap"
            >
              {loading ? "Requesting..." : "Request Account"}
            </Button>
          </div>
          {dvaError && (
            <p className="text-xs md:text-sm text-red-700">{dvaError}</p>
          )}
          {dva && (
            <div className="border rounded-lg p-3 md:p-4 text-xs md:text-sm space-y-1">
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
          )}
        </Card>
      </div>
    </div>
  );
}
