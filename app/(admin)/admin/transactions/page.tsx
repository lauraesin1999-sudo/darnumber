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
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Search,
  Filter,
  Eye,
  RefreshCw,
  Copy,
  ChevronLeft,
  ChevronRight,
  ArrowUpCircle,
  ArrowDownCircle,
  Download,
} from "lucide-react";
import { logger } from "@/lib/logger";

const TRANSACTION_TYPES = [
  { value: "all", label: "All Types" },
  { value: "DEPOSIT", label: "Deposit" },
  { value: "WITHDRAWAL", label: "Withdrawal" },
  { value: "ORDER_PAYMENT", label: "Order Payment" },
  { value: "REFUND", label: "Refund" },
  { value: "BONUS", label: "Bonus" },
  { value: "REFERRAL_REWARD", label: "Referral Reward" },
  { value: "ADMIN_ADJUSTMENT", label: "Admin Adjustment" },
];

const TRANSACTION_STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    PENDING: "bg-yellow-100 text-yellow-800",
    COMPLETED: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
    CANCELLED: "bg-gray-100 text-gray-800",
  };
  return colors[status] || "bg-gray-100 text-gray-800";
};

const getTypeColor = (type: string) => {
  const colors: Record<string, string> = {
    DEPOSIT: "bg-green-100 text-green-800",
    WITHDRAWAL: "bg-orange-100 text-orange-800",
    ORDER_PAYMENT: "bg-blue-100 text-blue-800",
    REFUND: "bg-teal-100 text-teal-800",
    BONUS: "bg-purple-100 text-purple-800",
    REFERRAL_REWARD: "bg-pink-100 text-pink-800",
    ADMIN_ADJUSTMENT: "bg-indigo-100 text-indigo-800",
  };
  return colors[type] || "bg-gray-100 text-gray-800";
};

export default function AdminTransactionsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });

  // Filters
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Modal
  const [selectedTransaction, setSelectedTransaction] = useState<any>(null);
  const [viewModalOpen, setViewModalOpen] = useState(false);

  // Stats
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getAdminTransactions({
        page: pagination.page,
        limit: pagination.limit,
        type: type !== "all" ? type : undefined,
        status: status !== "all" ? status : undefined,
        search: debouncedSearch || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setTransactions(response.data?.transactions || []);
      setPagination((prev: any) => ({
        ...prev,
        ...response.data?.pagination,
      }));
      if (response.data?.stats) {
        setStats(response.data.stats);
      }
    } catch (error: any) {
      logger.error("Failed to fetch transactions:", error);
      if (error.response?.status === 403) {
        toast.api.unauthorized();
        router.push("/dashboard");
      } else {
        toast.error("Failed to load transactions", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  }, [pagination.page, type, status, debouncedSearch, startDate, endDate]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

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

  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Transactions</h1>
        <Button variant="outline" onClick={() => fetchTransactions()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <ArrowDownCircle className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Deposits</p>
                <p className="text-xl font-bold text-green-600">
                  {formatCurrency(stats.totalDeposits || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <ArrowUpCircle className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Total Withdrawals
                </p>
                <p className="text-xl font-bold text-orange-600">
                  {formatCurrency(stats.totalWithdrawals || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <ArrowUpCircle className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Order Payments</p>
                <p className="text-xl font-bold text-blue-600">
                  {formatCurrency(stats.totalOrderPayments || 0)}
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-teal-100 rounded-lg">
                <RefreshCw className="w-5 h-5 text-teal-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Refunds</p>
                <p className="text-xl font-bold text-teal-600">
                  {formatCurrency(stats.totalRefunds || 0)}
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
              placeholder="Search by transaction number or reference..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select
            value={type}
            onValueChange={(val) => {
              setType(val);
              setPagination((p: any) => ({ ...p, page: 1 }));
            }}
          >
            <SelectTrigger className="w-full md:w-48">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {TRANSACTION_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(val) => {
              setStatus(val);
              setPagination((p: any) => ({ ...p, page: 1 }));
            }}
          >
            <SelectTrigger className="w-full md:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {TRANSACTION_STATUSES.map((s) => (
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
            {showFilters ? "Hide" : "More"}
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
                  setType("all");
                  setStatus("all");
                }}
              >
                Clear All Filters
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Transactions Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Transaction
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  User
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Type
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Balance
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Status
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
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">
                        {tx.transactionNumber}
                      </span>
                      <button
                        onClick={() => copyToClipboard(tx.transactionNumber)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium text-sm">
                        {tx.user?.userName || "N/A"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tx.user?.email}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={getTypeColor(tx.type)}>
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
                    <div className="text-sm">
                      <p>
                        Before:{" "}
                        {formatCurrency(Number(tx.balanceBefore), tx.currency)}
                      </p>
                      <p className="font-medium">
                        After:{" "}
                        {formatCurrency(Number(tx.balanceAfter), tx.currency)}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={getStatusColor(tx.status)}>
                      {tx.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {formatDate(tx.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSelectedTransaction(tx);
                        setViewModalOpen(true);
                      }}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {transactions.length === 0 && !loading && (
          <div className="p-8 text-center text-muted-foreground">
            No transactions found matching your criteria.
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between p-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing {(pagination.page - 1) * pagination.limit + 1} to{" "}
              {Math.min(pagination.page * pagination.limit, pagination.total)}{" "}
              of {pagination.total} transactions
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

      {/* View Transaction Modal */}
      <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Transaction Details</DialogTitle>
            <DialogDescription>
              {selectedTransaction?.transactionNumber}
            </DialogDescription>
          </DialogHeader>
          {selectedTransaction && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <div className="mt-1">
                    <Badge className={getTypeColor(selectedTransaction.type)}>
                      {selectedTransaction.type.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge
                      className={getStatusColor(selectedTransaction.status)}
                    >
                      {selectedTransaction.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Amount</Label>
                  <p className="text-lg font-bold">
                    {formatCurrency(
                      Number(selectedTransaction.amount),
                      selectedTransaction.currency
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Currency</Label>
                  <p className="font-medium">{selectedTransaction.currency}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">
                    Balance Before
                  </Label>
                  <p className="font-medium">
                    {formatCurrency(
                      Number(selectedTransaction.balanceBefore),
                      selectedTransaction.currency
                    )}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Balance After</Label>
                  <p className="font-medium">
                    {formatCurrency(
                      Number(selectedTransaction.balanceAfter),
                      selectedTransaction.currency
                    )}
                  </p>
                </div>
              </div>

              <div className="border-t pt-4">
                <Label className="text-muted-foreground">User</Label>
                <div className="mt-1">
                  <p className="font-medium">
                    {selectedTransaction.user?.userName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {selectedTransaction.user?.email}
                  </p>
                </div>
              </div>

              {selectedTransaction.description && (
                <div className="border-t pt-4">
                  <Label className="text-muted-foreground">Description</Label>
                  <p className="mt-1">{selectedTransaction.description}</p>
                </div>
              )}

              {selectedTransaction.adminNotes && (
                <div className="border-t pt-4">
                  <Label className="text-muted-foreground">Admin Notes</Label>
                  <p className="mt-1">{selectedTransaction.adminNotes}</p>
                </div>
              )}

              {selectedTransaction.paymentMethod && (
                <div className="border-t pt-4">
                  <Label className="text-muted-foreground">
                    Payment Method
                  </Label>
                  <p className="mt-1">{selectedTransaction.paymentMethod}</p>
                </div>
              )}

              {selectedTransaction.referenceId && (
                <div className="border-t pt-4">
                  <Label className="text-muted-foreground">Reference ID</Label>
                  <p className="font-mono text-sm">
                    {selectedTransaction.referenceId}
                  </p>
                </div>
              )}

              <div className="border-t pt-4 grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Created</Label>
                  <p className="text-sm">
                    {formatDate(selectedTransaction.createdAt)}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Updated</Label>
                  <p className="text-sm">
                    {formatDate(selectedTransaction.updatedAt)}
                  </p>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
