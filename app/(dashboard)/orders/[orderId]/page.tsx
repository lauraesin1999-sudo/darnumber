"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/lib/toast";
import { formatPhone } from "@/lib/phone";
import { logger } from "@/lib/logger";

export default function OrderDetailPage() {
  const router = useRouter();
  const params = useParams();
  const orderId = params?.orderId as string;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<{
    orderNumber: string;
    serviceCode: string;
    serviceName: string;
    country: string;
    countryName: string;
    provider: string;
    finalPrice: number;
    phoneNumber?: string;
    smsCode?: string;
    smsMessage?: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    expiresAt?: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [now, setNow] = useState<number>(Date.now());
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [countryNameByCode, setCountryNameByCode] = useState<
    Map<string, string>
  >(new Map());
  const [serviceNameByCode, setServiceNameByCode] = useState<
    Map<string, string>
  >(new Map());

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  };

  // Memoized values (must be before conditional logic)
  const expiresAtMs = useMemo(() => {
    return order?.expiresAt ? new Date(order.expiresAt).getTime() : null;
  }, [order?.expiresAt]);

  const remainingMs = useMemo(() => {
    if (!expiresAtMs) return null;
    return Math.max(0, expiresAtMs - now);
  }, [expiresAtMs, now]);

  // Tick every second to update countdown
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch country names and service names for display
  useEffect(() => {
    const loadMetadata = async () => {
      try {
        // Fetch countries
        const countryMap = new Map<string, string>();
        try {
          const res = await fetch("/api/providers/smsman/countries");
          if (res.ok) {
            const out = await res.json();
            const countries = out?.data?.countries || {};
            Object.entries(countries).forEach(([code, title]) => {
              if (code && title)
                countryMap.set(String(code).toUpperCase(), String(title));
            });
          }
        } catch {
          // Fallback to static list
          const mod = await import("@/lib/constants/countries");
          const list = mod.getCountryList?.() || [];
          list.forEach((c: any) => {
            if (c?.code && c?.name) {
              countryMap.set(String(c.code).toUpperCase(), c.name);
            }
          });
        }
        setCountryNameByCode(countryMap);

        // Fetch services to get display names
        const servicesRes = await api.getAvailableServices();
        const services = servicesRes?.data?.services || [];
        const serviceMap = new Map<string, string>();
        services.forEach((s: any) => {
          if (s.code && (s.ui?.displayName || s.name)) {
            serviceMap.set(
              String(s.code).toUpperCase(),
              s.ui?.displayName || s.name,
            );
          }
        });
        setServiceNameByCode(serviceMap);
      } catch (e) {
        logger.error("[OrderDetailPage] Failed to fetch metadata:", e);
      }
    };
    loadMetadata();
  }, []);

  const fetchOrder = async () => {
    try {
      const response = await api.getOrder(orderId);
      setOrder(response.data);
    } catch (error) {
      logger.error("Failed to fetch order:", error);
      setError("Failed to load order details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!orderId) return;

    fetchOrder();

    // Poll for updates every 5 seconds
    const interval = setInterval(() => {
      // Only fetch if we don't have an order yet, or if it's in an active status
      if (
        !order ||
        ["WAITING_FOR_SMS", "PENDING", "PROCESSING"].includes(order.status)
      ) {
        fetchOrder();
      }
    }, 5000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, order?.status]);

  // Notify when order is completed
  useEffect(() => {
    if (order?.status === "COMPLETED" && order.smsCode) {
      toast.success(
        "Order completed!",
        `Your verification code is ${order.smsCode}`,
      );
    }
  }, [order?.status, order?.smsCode]);

  const handleCancelClick = () => {
    setShowCancelDialog(true);
  };

  const handleCancelConfirm = async () => {
    setCancelling(true);
    setShowCancelDialog(false);
    try {
      await api.cancelOrder(orderId);
      toast.order.cancelled(order?.orderNumber);
      fetchOrder();
    } catch (err) {
      const error = err as {
        response?: { data?: { error?: { message: string } } };
      };
      const errorMsg =
        error.response?.data?.error?.message || "Failed to cancel order";
      toast.error("Cancel failed", errorMsg);
      setError(errorMsg);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="container mx-auto p-6">
        <h3 className="text-red-700">Order not found</h3>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-green-500";
      case "WAITING_FOR_SMS":
        return "bg-yellow-500";
      case "PENDING":
        return "bg-blue-500";
      case "PROCESSING":
        return "bg-indigo-500";
      case "EXPIRED":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const canCancel = ["PENDING", "PROCESSING", "WAITING_FOR_SMS"].includes(
    order.status,
  );

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const h = Math.floor(m / 60);
    const min = m % 60;
    return h > 0 ? `${h}h ${min}m ${sec}s` : `${min}m ${sec}s`;
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl space-y-6">
      <Button variant="ghost" onClick={() => router.back()}>
        ← Back to Orders
      </Button>

      {error && <h3 className="text-red-700">{error}</h3>}

      <Card className="p-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold">
              {serviceNameByCode.get(order.serviceCode.toUpperCase()) ||
                order.serviceName ||
                order.serviceCode.toUpperCase()}
            </h1>
            <p className="text-muted-foreground mt-1">
              Order #{order.orderNumber}
            </p>
          </div>
          <Badge className={getStatusColor(order.status)}>
            {order.status.replace(/_/g, " ")}
          </Badge>
        </div>

        {/* Phone Number */}
        {order.phoneNumber && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 rounded-lg mb-4 border border-blue-200 dark:border-blue-900">
            <div className="flex justify-between items-start mb-2">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                Phone Number
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const fmt = formatPhone(order.phoneNumber!, order.country);
                  copyToClipboard(fmt.e164, "Phone number");
                }}
                className="h-8 px-2 hover:bg-blue-100 dark:hover:bg-blue-900"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </Button>
            </div>
            <p className="text-2xl font-bold font-mono text-blue-700 dark:text-blue-300">
              {formatPhone(order.phoneNumber!, order.country).display}
            </p>
          </div>
        )}

        {/* SMS Message */}
        {order.smsMessage && (
          <div className="p-4 bg-green-50 dark:bg-green-950/30 rounded-lg mb-4 border border-green-200 dark:border-green-900">
            <div className="flex justify-between items-start mb-2">
              <p className="text-sm font-medium text-green-900 dark:text-green-100">
                SMS Message
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyToClipboard(order.smsMessage!, "SMS message")
                }
                className="h-8 px-2 hover:bg-green-100 dark:hover:bg-green-900"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </Button>
            </div>
            <p className="text-lg text-green-800 dark:text-green-200 mb-2">
              {order.smsMessage}
            </p>
            {order.smsCode && (
              <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-700">
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium text-green-900 dark:text-green-100">
                    Extracted Code
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(order.smsCode!, "Verification code")
                    }
                    className="h-8 px-2 hover:bg-green-100 dark:hover:bg-green-900"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </Button>
                </div>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400 font-mono mt-1">
                  {order.smsCode}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Order Details */}
        <div className="space-y-3 border-t pt-4 mt-4">
          <h2 className="font-semibold text-lg mb-3">Order Details</h2>

          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Service</span>
            <span className="font-medium">
              {serviceNameByCode.get(order.serviceCode.toUpperCase()) ||
                order.serviceName ||
                order.serviceCode.toUpperCase()}
            </span>
          </div>

          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Country</span>
            <span className="font-medium">
              {countryNameByCode.get(order.country.toUpperCase()) ||
                order.countryName ||
                order.country}
            </span>
          </div>

          <div className="flex justify-between py-2">
            <span className="text-muted-foreground">Amount Paid</span>
            <span className="font-semibold text-lg">
              ₦
              {Number(order.finalPrice).toLocaleString("en-NG", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>

          <div className="flex justify-between py-2 text-sm">
            <span className="text-muted-foreground">Created</span>
            <span className="font-medium">
              {new Date(order.createdAt).toLocaleString("en-US", {
                year: "numeric",
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
              })}
            </span>
          </div>

          {order.completedAt && (
            <div className="flex justify-between py-2 text-sm">
              <span className="text-muted-foreground">Completed</span>
              <span className="font-medium text-green-600 dark:text-green-400">
                {new Date(order.completedAt).toLocaleString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: true,
                })}
              </span>
            </div>
          )}

          {order.expiresAt && (
            <div className="flex justify-between items-center py-2 text-sm">
              <span className="text-muted-foreground">Expires At</span>
              <span className="font-medium text-amber-600 dark:text-amber-400">
                {new Date(order.expiresAt).toLocaleString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  hour12: true,
                })}
              </span>
            </div>
          )}
        </div>

        {/* Countdown & Status Messages */}
        {remainingMs !== null && canCancel && remainingMs > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 mt-6 p-4 rounded-lg">
            <p className="font-semibold text-amber-900 dark:text-amber-100">
              Time Remaining: {formatDuration(remainingMs)}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              This order will automatically cancel and refund if the SMS is not
              received.
            </p>
          </div>
        )}

        {order.status === "WAITING_FOR_SMS" && (
          <div className="mt-6 border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg">
            <p className="font-semibold text-blue-900 dark:text-blue-100">
              Waiting for SMS
            </p>
            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
              Your verification code will appear above once received. This page
              updates automatically.
            </p>
          </div>
        )}

        {order.status === "COMPLETED" && (
          <div className="mt-6 border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/20 p-4 rounded-lg">
            <p className="font-semibold text-green-900 dark:text-green-100">
              Order Completed
            </p>
            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
              Your verification code is ready! Click the copy button to use it.
            </p>
          </div>
        )}

        {order.status === "EXPIRED" && (
          <div className="mt-6 border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/20 p-4 rounded-lg">
            <p className="font-semibold text-red-900 dark:text-red-100">
              Order Expired
            </p>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              This order has expired. The full amount has been refunded to your
              wallet.
            </p>
          </div>
        )}

        {order.status === "CANCELLED" && (
          <div className="mt-6 border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/20 p-4 rounded-lg">
            <p className="font-semibold text-gray-900 dark:text-gray-100">
              Order Cancelled
            </p>
            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
              You cancelled this order. The amount has been refunded to your
              wallet.
            </p>
          </div>
        )}

        {/* Cancel Button */}
        {canCancel && (
          <Button
            variant="destructive"
            className="w-full mt-6"
            onClick={handleCancelClick}
            disabled={cancelling || (remainingMs !== null && remainingMs === 0)}
          >
            {cancelling ? "Cancelling..." : "Cancel Order"}
          </Button>
        )}
      </Card>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Order</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this order? This action will
              refund the amount to your wallet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep order</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
