"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { logger } from "@/lib/logger";

export default function AdminDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const response = await api.getAdminDashboard();
      setStats(response.data);
    } catch (error: any) {
      logger.error("Failed to fetch dashboard:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else if (error.response?.status === 401) {
        toast.auth.sessionExpired();
        router.push("/login");
      } else {
        toast.error("Failed to load dashboard", "Please try again later.");
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
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Admin Dashboard</h1>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">Total Users</p>
          <p className="text-3xl font-bold">{stats?.users?.total || 0}</p>
          <p className="text-sm text-green-600">
            +{stats?.users?.active || 0} active
          </p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">Total Orders</p>
          <p className="text-3xl font-bold">{stats?.orders?.total || 0}</p>
          <p className="text-sm text-blue-600">
            {stats?.orders?.pending || 0} pending
          </p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">Revenue (Today)</p>
          <p className="text-3xl font-bold">
            {stats?.revenue?.today?.toLocaleString("en-NG", {
              style: "currency",
              currency: "NGN",
            }) || "0.00"}
          </p>
          <p className="text-sm text-muted-foreground">
            {stats?.revenue?.total?.toLocaleString("en-NG", {
              style: "currency",
              currency: "NGN",
            }) || "0.00"}{" "}
            total
          </p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground">Success Rate</p>
          <p className="text-3xl font-bold">
            {stats?.orders?.successRate || 0}%
          </p>
          <p className="text-sm text-muted-foreground">
            {stats?.orders?.completed || 0} completed
          </p>
        </Card>
      </div>

      {/* Provider Status */}
      <Card className="p-6">
        <h2 className="text-xl font-bold mb-4">Provider Status</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {stats?.providers?.map((provider: any) => (
            <div key={provider.name} className="p-4 border rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{provider.name}</h3>
                <Badge
                  className={provider.enabled ? "bg-green-500" : "bg-red-500"}
                >
                  {provider.enabled ? "Active" : "Disabled"}
                </Badge>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Success Rate:</span>
                  <span>{provider.successRate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Response:</span>
                  <span>{provider.avgResponseTime}s</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">Recent Orders</h2>
          <div className="space-y-2">
            {stats?.recentOrders?.map((order: any) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-3 border rounded"
              >
                <div>
                  <p className="font-medium">{order.serviceCode}</p>
                  <p className="text-sm text-muted-foreground">
                    {order.orderNumber}
                  </p>
                </div>
                <Badge>{order.status}</Badge>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-bold mb-4">System Health</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span>API Status</span>
              <Badge className="bg-green-500">Operational</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Database</span>
              <Badge className="bg-green-500">Healthy</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Redis Cache</span>
              <Badge className="bg-green-500">Connected</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Queue System</span>
              <Badge className="bg-green-500">Running</Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
