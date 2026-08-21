"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/toast";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { logger } from "@/lib/logger";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [balance, setBalance] = useState<number>(0);
  const [recentOrders, setRecentOrders] = useState<any[]>([]);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      const [statsRes, balanceRes, ordersRes] = await Promise.all([
        api.getUserStats(),
        api.getBalance(),
        api.getOrders(1, 5),
      ]);

      setStats(statsRes.data);
      setBalance(balanceRes.data.balance);
      setRecentOrders(ordersRes.data);
    } catch (error: any) {
      logger.error("Failed to fetch dashboard data:", error);

      // Handle different error cases with appropriate toasts
      if (error.response?.status === 401) {
        toast.auth.sessionExpired();
        router.push("/login");
      } else if (error.response?.status === 500) {
        toast.api.serverError();
      } else if (error.response?.status === 404) {
        toast.api.notFound("Dashboard data");
      } else if (
        error.code === "ECONNABORTED" ||
        error.message === "Network Error"
      ) {
        toast.api.networkError();
      } else {
        toast.error(
          "Failed to load dashboard",
          error.response?.data?.message || "An unexpected error occurred."
        );
      }
    } finally {
      setLoading(false);
    }
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
      <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
          <Button
            onClick={() => router.push("/orders/new")}
            className="w-full sm:w-auto"
          >
            Buy Number
          </Button>
        </div>

        {/* Balance Card */}
        <Card className="p-4 md:p-6 bg-gradient-to-r from-blue-500 to-blue-600 text-white">
          <div className="space-y-2">
            <p className="text-xs md:text-sm opacity-90">Available Balance</p>
            <p className="text-3xl md:text-4xl font-bold">
              ₦{balance.toLocaleString()}
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button
                variant="secondary"
                onClick={() => router.push("/wallet")}
                className="w-full sm:w-auto"
              >
                Add Funds
              </Button>
            </div>
          </div>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <Card className="p-4 md:p-6">
            <p className="text-xs md:text-sm text-muted-foreground">
              Total Orders
            </p>
            <p className="text-2xl md:text-3xl font-bold">
              {stats?.orders?.total || 0}
            </p>
          </Card>
          <Card className="p-4 md:p-6">
            <p className="text-xs md:text-sm text-muted-foreground">
              Completed
            </p>
            <p className="text-2xl md:text-3xl font-bold text-green-600">
              {stats?.orders?.byStatus?.COMPLETED || 0}
            </p>
          </Card>
          <Card className="p-4 md:p-6">
            <p className="text-xs md:text-sm text-muted-foreground">Pending</p>
            <p className="text-2xl md:text-3xl font-bold text-yellow-600">
              {(stats?.orders?.byStatus?.PENDING || 0) +
                (stats?.orders?.byStatus?.WAITING_SMS || 0)}
            </p>
          </Card>
          <Card className="p-4 md:p-6">
            <p className="text-xs md:text-sm text-muted-foreground">
              Total Spent
            </p>
            <p className="text-2xl md:text-3xl font-bold">
              ₦{stats?.transactions?.totalSpent?.toLocaleString() || "0"}
            </p>
          </Card>
        </div>

        {/* Recent Orders */}
        <Card className="p-4 md:p-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
            <h2 className="text-lg md:text-xl font-bold">Recent Orders</h2>
            <Button
              variant="ghost"
              onClick={() => router.push("/orders")}
              className="w-full sm:w-auto"
            >
              View All
            </Button>
          </div>
          <div className="space-y-3 md:space-y-4">
            {recentOrders.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm md:text-base">
                No orders yet. Buy your first number to get started!
              </p>
            ) : (
              recentOrders.map((order) => (
                <div
                  key={order.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 md:p-4 border rounded-lg hover:bg-accent cursor-pointer gap-3 sm:gap-0"
                  onClick={() => router.push(`/orders/${order.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm md:text-base truncate">
                      {order.serviceCode}
                    </p>
                    <p className="text-xs md:text-sm text-muted-foreground truncate">
                      {order.orderNumber}
                    </p>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end sm:text-right gap-4">
                    <p className="font-medium text-sm md:text-base">
                      ₦{order.finalPrice.toLocaleString("en-US")}
                    </p>
                    <p
                      className={`text-xs md:text-sm px-2 py-1 rounded-full ${
                        order.status === "COMPLETED"
                          ? "text-green-600 bg-green-50"
                          : order.status === "WAITING_FOR_SMS"
                          ? "text-yellow-600 bg-yellow-50"
                          : order.status === "CANCELLED" ||
                            order.status === "EXPIRED" ||
                            order.status === "FAILED"
                          ? "text-red-600 bg-red-50"
                          : "text-gray-600 bg-gray-50"
                      }`}
                    >
                      {order.status}
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
