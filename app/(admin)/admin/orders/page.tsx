"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Filter,
  MoreVertical,
  Eye,
  XCircle,
  RefreshCw,
  Copy,
  ChevronLeft,
  ChevronRight,
  Download,
} from "lucide-react";
import { logger } from "@/lib/logger";

const ORDER_STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "PROCESSING", label: "Processing" },
  { value: "WAITING_FOR_SMS", label: "Waiting SMS" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "EXPIRED", label: "Expired" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REFUNDED", label: "Refunded" },
];

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800",
    PROCESSING: "bg-blue-100 text-blue-800",
    WAITING_FOR_SMS: "bg-purple-100 text-purple-800",
    COMPLETED: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
    EXPIRED: "bg-gray-100 text-gray-800",
    CANCELLED: "bg-orange-100 text-orange-800",
    REFUNDED: "bg-teal-100 text-teal-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
};

export default function AdminOrdersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });

  // Filters
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Modals
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Stats
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getAdminOrders({
        page: pagination.page,
        limit: pagination.limit,
        status: status !== "all" ? status : undefined,
        search: debouncedSearch || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setOrders(response.data?.orders || []);
      setPagination((prev: any) => ({
        ...prev,
        ...response.data?.pagination,
      }));
    } catch (error: any) {
      logger.error("Failed to fetch orders:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else {
        toast.error("Failed to load orders", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  }, [pagination.page, status, debouncedSearch, startDate, endDate]);

  const fetchStats = async () => {
    try {
      const response = await api.getOrderStats(startDate, endDate);
      setStats(response.data);
    } catch (error) {
      logger.error("Failed to fetch stats:", error);
    }
  };

  useEffect(() => {
    fetchOrders();
    fetchStats();
  }, [fetchOrders]);

  const handleRefund = async () => {
    if (!selectedOrder) return;
    setActionLoading(true);
    try {
      await api.refundOrder(selectedOrder.id, refundReason);
      toast.success(
        "Order refunded",
        "The order has been refunded successfully."
      );
      setRefundModalOpen(false);
      setRefundReason("");
      setSelectedOrder(null);
      fetchOrders();
      fetchStats();
    } catch (error: any) {
      toast.error(
        "Refund failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelOrder = async (order: any) => {
    setActionLoading(true);
    try {
      await api.adminCancelOrder(order.id);
      toast.success("Order cancelled", "The order has been cancelled.");
      fetchOrders();
      fetchStats();
    } catch (error: any) {
      toast.error(
        "Cancel failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied", "Copied to clipboard");
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString();
  };

  const formatCurrency = (amount: number, currency: string = "NGN") => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
    }).format(amount);
  };

  if (loading && orders.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Orders Management</h1>
        <Button variant="outline" onClick={() => fetchOrders()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Total Orders</p>
            <p className="text-2xl font-bold">{stats.totalOrders || 0}</p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Completed</p>
            <p className="text-2xl font-bold text-green-600">
              {stats.ordersByStatus?.find((s: any) => s.status === "COMPLETED")
                ?._count || 0}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Pending</p>
            <p className="text-2xl font-bold text-yellow-600">
              {stats.ordersByStatus?.find((s: any) => s.status === "PENDING")
                ?._count || 0}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-bold">
              {formatCurrency(Number(stats.totalRevenue) || 0)}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm text-muted-foreground">Profit</p>
            <p className="text-2xl font-bold text-green-600">
              {formatCurrency(Number(stats.totalProfit) || 0)}
            </p>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search by order number, phone, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={status}
            onValueChange={(val) => {
              setStatus(val);
              setPagination((p: any) => ({ ...p, page: 1 }));
            }}
          >
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              {ORDER_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4 mr-2" />
            {showFilters ? "Hide Filters" : "More Filters"}
          </Button>
        </div>

        {showFilters && (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
            <div>
              <Label>Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label>End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                  setSearch("");
                  setStatus("all");
                }}
              >
                Clear All Filters
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Orders Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Order
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  User
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Service
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Phone
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Price
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((order) => (
                <tr key={order.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {order.orderNumber}
                      </span>
                      <button
                        onClick={() => copyToClipboard(order.orderNumber)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">
                        {order.user?.userName || "N/A"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {order.user?.email}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">{order.serviceCode}</p>
                      <p className="text-xs text-muted-foreground">
                        {order.country}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {order.phoneNumber ? (
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">
                          {order.phoneNumber}
                        </span>
                        <button
                          onClick={() => copyToClipboard(order.phoneNumber)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={getStatusColor(order.status)}>
                      {order.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">
                        {formatCurrency(Number(order.finalPrice))}
                      </p>
                      {order.cost && (
                        <p className="text-xs text-muted-foreground">
                          Cost: {formatCurrency(Number(order.cost))}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(order.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedOrder(order);
                            setViewModalOpen(true);
                          }}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {["PENDING", "PROCESSING", "WAITING_FOR_SMS"].includes(
                          order.status
                        ) && (
                          <DropdownMenuItem
                            onClick={() => handleCancelOrder(order)}
                            className="text-orange-600"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Cancel Order
                          </DropdownMenuItem>
                        )}
                        {[
                          "COMPLETED",
                          "CANCELLED",
                          "FAILED",
                          "EXPIRED",
                        ].includes(order.status) &&
                          order.status !== "REFUNDED" && (
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedOrder(order);
                                setRefundModalOpen(true);
                              }}
                              className="text-teal-600"
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              Issue Refund
                            </DropdownMenuItem>
                          )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {orders.length === 0 && !loading && (
          <div className="p-8 text-center text-muted-foreground">
            No orders found matching your criteria.
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
              of {pagination.total} orders
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page === 1}
                onClick={() =>
                  setPagination((p: any) => ({ ...p, page: p.page - 1 }))
                }
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="flex items-center px-3 text-sm">
                Page {pagination.page} of {pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page === pagination.pages}
                onClick={() =>
                  setPagination((p: any) => ({ ...p, page: p.page + 1 }))
                }
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* View Order Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Details</DialogTitle>
            <DialogDescription>
              Order #{selectedOrder?.orderNumber}
            </DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={getStatusColor(selectedOrder.status)}>
                      {selectedOrder.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Provider</Label>
                  <p className="font-medium">{selectedOrder.providerId}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Service</Label>
                  <p className="font-medium">{selectedOrder.serviceCode}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Country</Label>
                  <p className="font-medium">{selectedOrder.country}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone Number</Label>
                  <p className="font-mono">
                    {selectedOrder.phoneNumber || "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">SMS Code</Label>
                  <p className="font-mono">{selectedOrder.smsCode || "—"}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Price</Label>
                  <p className="font-medium">
                    {formatCurrency(Number(selectedOrder.finalPrice))}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Cost</Label>
                  <p className="font-medium">
                    {formatCurrency(Number(selectedOrder.cost || 0))}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-muted-foreground">User</Label>
                <div className="mt-1">
                  <p className="font-medium">{selectedOrder.user?.userName}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedOrder.user?.email}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4 grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Created</Label>
                  <p className="text-sm">
                    {formatDate(selectedOrder.createdAt)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Updated</Label>
                  <p className="text-sm">
                    {formatDate(selectedOrder.updatedAt)}
                  </p>
                </div>
                {selectedOrder.expiresAt && (
                  <div>
                    <Label className="text-muted-foreground">Expires</Label>
                    <p className="text-sm">
                      {formatDate(selectedOrder.expiresAt)}
                    </p>
                  </div>
                )}
              </div>

              <div className="border-t pt-4">
                <Label className="text-muted-foreground">External ID</Label>
                <p className="font-mono text-sm">
                  {selectedOrder.externalId || "—"}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Refund Modal */}
      <Dialog open={refundModalOpen} onOpenChange={setRefundModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Refund</DialogTitle>
            <DialogDescription>
              Refund order #{selectedOrder?.orderNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount to Refund</Label>
              <p className="text-2xl font-bold">
                {formatCurrency(Number(selectedOrder?.finalPrice || 0))}
              </p>
            </div>
            <div>
              <Label>Reason for Refund</Label>
              <Textarea
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Enter the reason for this refund..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRefund}
              disabled={actionLoading || !refundReason}
            >
              {actionLoading ? (
                <Spinner className="w-4 h-4" />
              ) : (
                "Confirm Refund"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
