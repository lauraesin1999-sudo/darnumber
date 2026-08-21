"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
  RefreshCw,
  MoreVertical,
  Eye,
  Edit,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Users,
  UserCheck,
  UserX,
  Shield,
} from "lucide-react";
import { logger } from "@/lib/logger";

const USER_STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "BANNED", label: "Banned" },
  { value: "PENDING_VERIFICATION", label: "Pending" },
];

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-800",
    SUSPENDED: "bg-red-100 text-red-800",
    BANNED: "bg-gray-800 text-white",
    PENDING_VERIFICATION: "bg-yellow-100 text-yellow-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
};

export default function AdminUsersPage() {
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
  const [status, setStatus] = useState("all");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Balance adjustment modal
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<"add" | "deduct">("add");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Stats
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getUsers({
        page: pagination.page,
        limit: pagination.limit,
        search: debouncedSearch || undefined,
        status: status !== "all" ? status : undefined,
      });
      setUsers(response.data?.users || []);
      setPagination((prev: any) => ({
        ...prev,
        ...response.data?.pagination,
      }));
    } catch (error: any) {
      logger.error("Failed to fetch users:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else {
        toast.error("Failed to load users", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  }, [pagination.page, debouncedSearch, status]);

  const fetchStats = async () => {
    try {
      const [activeCount, suspendedCount, totalCount] = await Promise.all([
        api.getUsers({ status: "ACTIVE", limit: 1 }),
        api.getUsers({ status: "SUSPENDED", limit: 1 }),
        api.getUsers({ limit: 1 }),
      ]);
      setStats({
        total: totalCount.data?.pagination?.total || 0,
        active: activeCount.data?.pagination?.total || 0,
        suspended: suspendedCount.data?.pagination?.total || 0,
      });
    } catch (error) {
      logger.error("Failed to fetch stats:", error);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchStats();
  }, []);

  const handleToggleStatus = async (user: any) => {
    const newStatus = user.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    setActionLoading(true);
    try {
      await api.updateUser(user.id, { status: newStatus });
      toast.success(
        "Status updated",
        `User has been ${newStatus === "ACTIVE" ? "activated" : "suspended"}.`
      );
      fetchUsers();
      fetchStats();
    } catch (error: any) {
      toast.error(
        "Status update failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(false);
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
      fetchUsers();
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
        <h1 className="text-3xl font-bold">User Management</h1>
        <Button variant="outline" onClick={() => fetchUsers()}>
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
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Users</p>
                <p className="text-xl font-bold">{stats.total}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <UserCheck className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active</p>
                <p className="text-xl font-bold text-green-600">
                  {stats.active}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <UserX className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Suspended</p>
                <p className="text-xl font-bold text-red-600">
                  {stats.suspended}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Shield className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Admins</p>
                <p className="text-xl font-bold text-purple-600">
                  {
                    users.filter(
                      (u) => u.role === "ADMIN" || u.role === "SUPER_ADMIN"
                    ).length
                  }
                </p>
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
              {USER_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Users Table */}
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
                  Status
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Role
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Orders
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Joined
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
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="hover:underline"
                    >
                      <p className="font-medium">{user.userName}</p>
                      <p className="text-sm text-muted-foreground">
                        {user.email}
                      </p>
                      {user.phone && (
                        <p className="text-xs text-muted-foreground">
                          {user.phone}
                        </p>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p
                      className={`font-medium ${
                        Number(user.balance) > 0
                          ? "text-green-600"
                          : "text-gray-500"
                      }`}
                    >
                      {formatCurrency(Number(user.balance), user.currency)}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={getStatusColor(user.status)}>
                      {user.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={
                        user.role === "ADMIN" || user.role === "SUPER_ADMIN"
                          ? "border-purple-200 text-purple-700"
                          : ""
                      }
                    >
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {user._count?.orders || 0}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(user.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/admin/users/${user.id}`}>
                            <Eye className="w-4 h-4 mr-2" />
                            View Details
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedUser(user);
                            setAdjustType("add");
                            setAdjustModalOpen(true);
                          }}
                          className="text-green-600"
                        >
                          <Plus className="w-4 h-4 mr-2" />
                          Add Funds
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedUser(user);
                            setAdjustType("deduct");
                            setAdjustModalOpen(true);
                          }}
                          className="text-red-600"
                        >
                          <Minus className="w-4 h-4 mr-2" />
                          Deduct Funds
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleToggleStatus(user)}
                          className={
                            user.status === "ACTIVE"
                              ? "text-red-600"
                              : "text-green-600"
                          }
                        >
                          {user.status === "ACTIVE" ? (
                            <>
                              <UserX className="w-4 h-4 mr-2" />
                              Suspend User
                            </>
                          ) : (
                            <>
                              <UserCheck className="w-4 h-4 mr-2" />
                              Activate User
                            </>
                          )}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users.length === 0 && !loading && (
          <div className="p-8 text-center text-muted-foreground">
            No users found matching your criteria.
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
              of {pagination.total} users
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
    </div>
  );
}
