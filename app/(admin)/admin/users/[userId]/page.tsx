"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Mail,
  Phone,
  Globe,
  Calendar,
  CreditCard,
  Shield,
  Edit,
  Plus,
  Minus,
  RefreshCw,
  Copy,
} from "lucide-react";
import { logger } from "@/lib/logger";

export default function AdminUserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.userId as string;

  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    status: "",
    role: "",
  });

  // Balance adjustment modal
  const [adjustModalOpen, setAdjustModalOpen] = useState(false);
  const [adjustType, setAdjustType] = useState<"add" | "deduct">("add");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  useEffect(() => {
    fetchUserDetails();
  }, [userId]);

  const fetchUserDetails = async () => {
    setLoading(true);
    try {
      const response = await api.getUserDetails(userId);
      setUserData(response.data);
      setEditForm({
        status: response.data.user?.status || "",
        role: response.data.user?.role || "",
      });
    } catch (error: any) {
      logger.error("Failed to fetch user:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else if (error.response?.status === 404) {
        toast.error("User not found", "This user does not exist.");
        router.push("/admin/users");
      } else {
        toast.error("Failed to load user", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateUser = async () => {
    setActionLoading(true);
    try {
      await api.updateUser(userId, editForm);
      toast.success("User updated", "User details have been updated.");
      setEditModalOpen(false);
      fetchUserDetails();
    } catch (error: any) {
      toast.error(
        "Update failed",
        error.response?.data?.error?.message || "Please try again."
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdjustBalance = async () => {
    if (!adjustAmount || !adjustReason) return;
    setActionLoading(true);
    try {
      const amount =
        adjustType === "add"
          ? parseFloat(adjustAmount)
          : -parseFloat(adjustAmount);
      await api.adjustUserBalance(userId, amount, adjustReason);
      toast.success(
        "Balance adjusted",
        `Successfully ${
          adjustType === "add" ? "added" : "deducted"
        } ₦${parseFloat(adjustAmount).toLocaleString()}`
      );
      setAdjustModalOpen(false);
      setAdjustAmount("");
      setAdjustReason("");
      fetchUserDetails();
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
    return new Date(date).toLocaleString();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied", "Copied to clipboard");
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      ACTIVE: "bg-green-100 text-green-800",
      SUSPENDED: "bg-red-100 text-red-800",
      BANNED: "bg-gray-800 text-white",
      PENDING_VERIFICATION: "bg-yellow-100 text-yellow-800",
    };
    return colors[status] || "bg-gray-100 text-gray-800";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-muted-foreground">User not found.</p>
      </div>
    );
  }

  const user = userData.user;
  const stats = userData.stats;

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.push("/admin/users")}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Users
        </Button>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">{user.userName}</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => fetchUserDetails()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Button variant="outline" onClick={() => setEditModalOpen(true)}>
            <Edit className="w-4 h-4 mr-2" />
            Edit User
          </Button>
        </div>
      </div>

      {/* User Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Balance</p>
          <p className="text-2xl font-bold text-green-600">
            {formatCurrency(Number(user.balance), user.currency)}
          </p>
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              variant="outline"
              className="text-green-600"
              onClick={() => {
                setAdjustType("add");
                setAdjustModalOpen(true);
              }}
            >
              <Plus className="w-3 h-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600"
              onClick={() => {
                setAdjustType("deduct");
                setAdjustModalOpen(true);
              }}
            >
              <Minus className="w-3 h-3" />
            </Button>
          </div>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Status</p>
          <div className="mt-1">
            <Badge className={getStatusColor(user.status)}>{user.status}</Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Role: <span className="font-medium">{user.role}</span>
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Total Orders</p>
          <p className="text-2xl font-bold">{stats?.totalOrders || 0}</p>
          <p className="text-xs text-muted-foreground">
            {formatCurrency(stats?.totalSpent || 0)} spent
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">Joined</p>
          <p className="text-lg font-medium">
            {formatDate(user.createdAt).split(",")[0]}
          </p>
          <p className="text-xs text-muted-foreground">
            Last login:{" "}
            {user.lastLoginAt ? formatDate(user.lastLoginAt) : "Never"}
          </p>
        </Card>
      </div>

      {/* Details Tabs */}
      <Tabs defaultValue="info" className="space-y-4">
        <TabsList>
          <TabsTrigger value="info">User Info</TabsTrigger>
          <TabsTrigger value="orders">
            Orders ({user.orders?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="transactions">
            Transactions ({user.transactions?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
        </TabsList>

        {/* User Info Tab */}
        <TabsContent value="info">
          <Card className="p-6">
            <h3 className="font-semibold mb-4">User Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Email</p>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{user.email}</p>
                      {user.emailVerified && (
                        <Badge className="bg-green-100 text-green-800">
                          Verified
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{user.phone || "—"}</p>
                      {user.phone && user.phoneVerified && (
                        <Badge className="bg-green-100 text-green-800">
                          Verified
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Globe className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Country</p>
                    <p className="font-medium">{user.country || "—"}</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Bank Details
                    </p>
                    <p className="font-medium">{user.bankName || "Not set"}</p>
                    {user.accountNumber && (
                      <p className="text-sm text-muted-foreground">
                        {user.accountNumber}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Security</p>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">
                        2FA: {user.twoFactorEnabled ? "Enabled" : "Disabled"}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Referral Code
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono">{user.referralCode || "—"}</p>
                      {user.referralCode && (
                        <button
                          onClick={() => copyToClipboard(user.referralCode)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Orders Tab */}
        <TabsContent value="orders">
          <Card className="overflow-hidden">
            {user.orders?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Order
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
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {user.orders.map((order: any) => (
                      <tr key={order.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-sm">
                          {order.orderNumber}
                        </td>
                        <td className="px-4 py-3">
                          {order.serviceCode} ({order.country})
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">
                          {order.phoneNumber || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={
                              order.status === "COMPLETED"
                                ? "bg-green-100 text-green-800"
                                : order.status === "PENDING"
                                ? "bg-yellow-100 text-yellow-800"
                                : order.status === "REFUNDED"
                                ? "bg-teal-100 text-teal-800"
                                : "bg-gray-100 text-gray-800"
                            }
                          >
                            {order.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {formatCurrency(Number(order.finalPrice))}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatDate(order.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                No orders found.
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card className="overflow-hidden">
            {user.transactions?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Transaction
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Type
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Amount
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Balance After
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {user.transactions.map((tx: any) => (
                      <tr key={tx.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-mono text-sm">
                          {tx.transactionNumber}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline">
                            {tx.type.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`font-medium ${
                              [
                                "DEPOSIT",
                                "REFUND",
                                "BONUS",
                                "REFERRAL_REWARD",
                              ].includes(tx.type)
                                ? "text-green-600"
                                : "text-red-600"
                            }`}
                          >
                            {[
                              "DEPOSIT",
                              "REFUND",
                              "BONUS",
                              "REFERRAL_REWARD",
                            ].includes(tx.type)
                              ? "+"
                              : "-"}
                            {formatCurrency(Number(tx.amount), tx.currency)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {formatCurrency(Number(tx.balanceAfter), tx.currency)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={
                              tx.status === "COMPLETED"
                                ? "bg-green-100 text-green-800"
                                : tx.status === "PENDING"
                                ? "bg-yellow-100 text-yellow-800"
                                : "bg-gray-100 text-gray-800"
                            }
                          >
                            {tx.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {formatDate(tx.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                No transactions found.
              </div>
            )}
          </Card>
        </TabsContent>

        {/* Activity Log Tab */}
        <TabsContent value="activity">
          <Card className="overflow-hidden">
            {user.activityLogs?.length > 0 ? (
              <div className="divide-y">
                {user.activityLogs.map((log: any) => (
                  <div key={log.id} className="p-4 hover:bg-muted/30">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{log.action}</p>
                        <p className="text-sm text-muted-foreground">
                          {log.resource}{" "}
                          {log.resourceId ? `• ${log.resourceId}` : ""}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {formatDate(log.createdAt)}
                      </p>
                    </div>
                    {log.ipAddress && (
                      <p className="text-xs text-muted-foreground mt-1">
                        IP: {log.ipAddress}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">
                No activity logs found.
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit User Modal */}
      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(val) =>
                  setEditForm({ ...editForm, status: val })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                  <SelectItem value="BANNED">Banned</SelectItem>
                  <SelectItem value="PENDING_VERIFICATION">
                    Pending Verification
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(val) => setEditForm({ ...editForm, role: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">User</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                  <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateUser} disabled={actionLoading}>
              {actionLoading ? <Spinner className="w-4 h-4" /> : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust Balance Modal */}
      <Dialog open={adjustModalOpen} onOpenChange={setAdjustModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {adjustType === "add" ? "Add Funds" : "Deduct Funds"}
            </DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Current Balance</Label>
              <p className="text-2xl font-bold">
                {formatCurrency(Number(user.balance), user.currency)}
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
                      ? Number(user.balance) + parseFloat(adjustAmount || "0")
                      : Number(user.balance) - parseFloat(adjustAmount || "0"),
                    user.currency
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
