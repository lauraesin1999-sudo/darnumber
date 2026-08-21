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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Wallet,
  Plus,
  Minus,
  Eye,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { logger } from "@/lib/logger";

export default function AdminWalletsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });

  // Filters
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("balance-desc");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Balance adjustment modal
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<"add" | "deduct">("add");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // User detail modal
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [userDetails, setUserDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Stats
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getAdminWallets({
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch || undefined,
        sortBy: sortBy,
      });
      setUsers(response.data?.users || []);
      setPagination((prev: any) => ({
        ...prev,
        ...response.data?.pagination,
      }));
      if (response.data?.stats) {
        setStats(response.data.stats);
      }
    } catch (error: any) {
      logger.error("Failed to fetch wallets:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else {
        toast.error("Failed to load wallets", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  }, [pagination.page, debouncedSearch, sortBy]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  const fetchUserDetails = async (userId: string) => {
    setLoadingDetails(true);
    try {
      const response = await api.getUserDetails(userId);
      setUserDetails(response.data);
    } catch (error: any) {
      toast.error("Failed to load user details", "Please try again.");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleAdjustBalance = async () => {
    if (!selectedUser || !adjustAmount || !adjustReason) return;
    setActionLoading(true);
    try {
      const amount =
        adjustType === "add"
          ? parseFloat(adjustAmount)
          : -parseFloat(adjustAmount);
      await api.adjustUserBalance(selectedUser.id, amount, adjustReason);
      toast.success(
        "Balance adjusted",
        `Successfully ${
          adjustType === "add" ? "added" : "deducted"
        } ₦${parseFloat(adjustAmount).toLocaleString()}`
      );
      setAdjustModalOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      setSelectedUser(null);
      fetchWallets();
    } catch (error: any) {
      toast.error(
        "Adjustment failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const formatCurrency = (amount: number, currency: string = "NGN") => {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString();
  };

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Wallet Management</h1>
        <Button variant="outline" onClick={() => fetchWallets()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Wallet className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Balance</p>
                <p className="text-xl font-bold">
                  {formatCurrency(stats.totalBalance || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Balance</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(stats.avgBalance || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Highest Balance</p>
                <p className="text-xl font-bold text-purple-600">
                  {formatCurrency(stats.maxBalance || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Wallet className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Wallets</p>
                <p className="text-xl font-bold">{stats.activeWallets || 0}</p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input
              placeholder="Search by email, username, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-full md:w-56">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balance-desc">
                Balance (High to Low)
              </SelectItem>
              <SelectItem value="balance-asc">Balance (Low to High)</SelectItem>
              <SelectItem value="name-asc">Name (A-Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z-A)</SelectItem>
              <SelectItem value="recent">Recently Active</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Wallets Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  User
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Balance
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Currency
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Orders
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Last Login
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{user.userName}</p>
                      <p className="text-sm text-muted-foreground">
                        {user.email}
                      </p>
                      {user.phone && (
                        <p className="text-xs text-muted-foreground">
                          {user.phone}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      className={`text-lg font-bold ${
                        Number(user.balance) > 0
                          ? "text-green-600"
                          : "text-gray-500"
                      }`}
                    >
                      {formatCurrency(Number(user.balance), user.currency)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{user.currency}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        user.status === "ACTIVE"
                          ? "bg-green-100 text-green-800"
                          : user.status === "SUSPENDED"
                          ? "bg-red-100 text-red-800"
                          : "bg-gray-100 text-gray-800"
                      }
                    >
                      {user.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm">
                      {user._count?.orders || 0} orders
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedUser(user);
                          fetchUserDetails(user.id);
                          setDetailModalOpen(true);
                        }}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-green-600"
                        onClick={() => {
                          setSelectedUser(user);
                          setAdjustType("add");
                          setAdjustModalOpen(true);
                        }}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-red-600"
                        onClick={() => {
                          setSelectedUser(user);
                          setAdjustType("deduct");
                          setAdjustModalOpen(true);
                        }}
                      >
                        <Minus className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users.length === 0 && !loading && (
          <div className="p-8 text-center text-muted-foreground">
            No wallets found matching your criteria.
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
              of {pagination.total} wallets
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

      {/* Adjust Balance Modal */}
      <Dialog open={adjustModalOpen} onOpenChange={setAdjustModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustType === "add" ? "Add Funds" : "Deduct Funds"}
            </DialogTitle>
            <DialogDescription>
              {selectedUser?.userName} ({selectedUser?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Current Balance</Label>
              <p className="text-2xl font-bold">
                {formatCurrency(
                  Number(selectedUser?.balance || 0),
                  selectedUser?.currency
                )}
              </p>
            </div>
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="Enter amount"
              />
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Enter reason for this adjustment..."
                rows={3}
              />
            </div>
            {adjustAmount && (
              <div className="p-3 bg-muted rounded-lg">
                <Label className="text-muted-foreground">New Balance</Label>
                <p className="text-xl font-bold">
                  {formatCurrency(
                    adjustType === "add"
                      ? Number(selectedUser?.balance || 0) +
                          parseFloat(adjustAmount || "0")
                      : Number(selectedUser?.balance || 0) -
                          parseFloat(adjustAmount || "0"),
                    selectedUser?.currency
                  )}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAdjustBalance}
              disabled={actionLoading || !adjustAmount || !adjustReason}
              className={adjustType === "add" ? "bg-green-600" : "bg-red-600"}
            >
              {actionLoading ? (
                <Spinner className="w-4 h-4" />
              ) : adjustType === "add" ? (
                "Add Funds"
              ) : (
                "Deduct Funds"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Details Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>User Details</DialogTitle>
            <DialogDescription>{selectedUser?.email}</DialogDescription>
          </DialogHeader>
          {loadingDetails ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : userDetails ? (
            <div className="space-y-6">
              {/* User Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Username</Label>
                  <p className="font-medium">{userDetails.user?.userName}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-medium">{userDetails.user?.email}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Phone</Label>
                  <p className="font-medium">
                    {userDetails.user?.phone || "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Country</Label>
                  <p className="font-medium">
                    {userDetails.user?.country || "—"}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Balance</Label>
                  <p className="text-xl font-bold text-green-600">
                    {formatCurrency(Number(userDetails.user?.balance || 0))}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge
                      className={
                        userDetails.user?.status === "ACTIVE"
                          ? "bg-green-100 text-green-800"
                          : "bg-red-100 text-red-800"
                      }
                    >
                      {userDetails.user?.status}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Stats */}
              {userDetails.stats && (
                <div className="border-t pt-4">
                  <Label className="text-muted-foreground">Statistics</Label>
                  <div className="grid grid-cols-3 gap-4 mt-2">
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-2xl font-bold">
                        {userDetails.stats.totalOrders || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Total Orders
                      </p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-2xl font-bold text-green-600">
                        {formatCurrency(userDetails.stats.totalSpent || 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Total Spent
                      </p>
                    </div>
                    <div className="p-3 bg-muted rounded-lg text-center">
                      <p className="text-2xl font-bold">
                        {userDetails.user?.transactions?.length || 0}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Transactions
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Recent Orders */}
              {userDetails.user?.orders?.length > 0 && (
                <div className="border-t pt-4">
                  <Label className="text-muted-foreground">Recent Orders</Label>
                  <div className="mt-2 space-y-2">
                    {userDetails.user.orders.slice(0, 5).map((order: any) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between p-2 bg-muted rounded"
                      >
                        <div>
                          <p className="font-mono text-sm">
                            {order.orderNumber}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {order.serviceCode} • {order.country}
                          </p>
                        </div>
                        <Badge
                          className={
                            order.status === "COMPLETED"
                              ? "bg-green-100 text-green-800"
                              : order.status === "PENDING"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-gray-100 text-gray-800"
                          }
                        >
                          {order.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Transactions */}
              {userDetails.user?.transactions?.length > 0 && (
                <div className="border-t pt-4">
                  <Label className="text-muted-foreground">
                    Recent Transactions
                  </Label>
                  <div className="mt-2 space-y-2">
                    {userDetails.user.transactions
                      .slice(0, 5)
                      .map((tx: any) => (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between p-2 bg-muted rounded"
                        >
                          <div>
                            <p className="font-mono text-sm">
                              {tx.transactionNumber}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {tx.type}
                            </p>
                          </div>
                          <p
                            className={`font-medium ${
                              ["DEPOSIT", "REFUND", "BONUS"].includes(tx.type)
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {["DEPOSIT", "REFUND", "BONUS"].includes(tx.type)
                              ? "+"
                              : "-"}
                            {formatCurrency(Number(tx.amount))}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
