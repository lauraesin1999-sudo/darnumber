"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Filter,
  ArrowLeft,
} from "lucide-react";
import { logger } from "@/lib/logger";

interface Transaction {
  id: string;
  transactionNumber: string;
  type: string;
  amount: number;
  currency: string;
  balanceBefore: number;
  balanceAfter: number;
  orderId: string | null;
  referenceId: string | null;
  paymentMethod: string | null;
  status: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

function TransactionsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    pages: 0,
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState(
    searchParams.get("search") || ""
  );
  const [typeFilter, setTypeFilter] = useState(
    searchParams.get("type") || "all"
  );
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") || "all"
  );
  const [showFilters, setShowFilters] = useState(false);

  // Debounce search
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const page = parseInt(searchParams.get("page") || "1");
    setPagination((prev) => ({ ...prev, page }));
  }, [searchParams]);

  useEffect(() => {
    fetchTransactions();
  }, [pagination.page, debouncedSearch, typeFilter, statusFilter]);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const response = await api.getTransactions(
        pagination.page,
        pagination.limit,
        {
          search: debouncedSearch || undefined,
          type: typeFilter !== "all" ? typeFilter : undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
        }
      );
      setTransactions(response.data);
      setPagination((prev) => ({
        ...prev,
        ...response.pagination,
      }));
    } catch (error: any) {
      logger.error("Failed to fetch transactions:", error);
      if (error.response?.status === 401) {
        toast.auth.sessionExpired();
        router.push("/login");
      } else {
        toast.error("Failed to load transactions", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", newPage.toString());
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    router.push(`/transactions?${params.toString()}`);
  };

  const clearFilters = () => {
    setSearchQuery("");
    setTypeFilter("all");
    setStatusFilter("all");
    router.push("/transactions");
  };

  const getStatusColor = (status: string) => {
    switch (status.toUpperCase()) {
      case "COMPLETED":
      case "SUCCESS":
        return "bg-green-100 text-green-800 border-green-200";
      case "PENDING":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "FAILED":
      case "CANCELLED":
        return "bg-red-100 text-red-800 border-red-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type.toUpperCase()) {
      case "DEPOSIT":
      case "REFUND":
        return "text-green-600";
      case "DEDUCTION":
      case "WITHDRAWAL":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  if (loading && transactions.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner />
      </div>
    );
  }

  const hasActiveFilters =
    debouncedSearch || typeFilter !== "all" || statusFilter !== "all";

  return (
    <div className="w-full">
      <div className="container mx-auto p-4 md:p-6 max-w-6xl space-y-4 md:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.back()}
              className="h-8 w-8 p-0"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold">Transactions</h1>
              <p className="text-sm text-muted-foreground">
                {pagination.total} total transaction
                {pagination.total !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="sm:hidden"
          >
            <Filter className="h-4 w-4 mr-2" />
            Filters
          </Button>
        </div>

        {/* Search and Filters */}
        <Card
          className={`p-4 space-y-4 ${
            showFilters ? "block" : "hidden sm:block"
          }`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div className="sm:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by transaction number or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            {/* Type Filter */}
            <div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Transaction Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="DEPOSIT">Deposit</SelectItem>
                  <SelectItem value="DEDUCTION">Deduction</SelectItem>
                  <SelectItem value="REFUND">Refund</SelectItem>
                  {/* <SelectItem value="WITHDRAWAL">Withdrawal</SelectItem> */}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-sm text-muted-foreground">
                Showing filtered results
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8"
              >
                Clear Filters
              </Button>
            </div>
          )}
        </Card>

        {/* Transactions List */}
        <div className="space-y-3">
          {loading ? (
            <Card className="p-8 flex items-center justify-center">
              <Spinner />
            </Card>
          ) : transactions.length === 0 ? (
            <Card className="p-8">
              <div className="text-center space-y-2">
                <p className="text-lg font-medium text-muted-foreground">
                  No transactions found
                </p>
                {hasActiveFilters && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear Filters
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            transactions.map((tx) => (
              <Card
                key={tx.id}
                className="p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  {/* Left Section */}
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <p className="font-medium text-sm md:text-base">
                        {tx.type}
                      </p>
                      <Badge
                        variant="outline"
                        className={`text-xs ${getStatusColor(tx.status)}`}
                      >
                        {tx.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {tx.transactionNumber}
                    </p>
                    {tx.description && (
                      <p className="text-xs md:text-sm text-muted-foreground line-clamp-1">
                        {tx.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        {new Date(tx.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                      <span>
                        {new Date(tx.createdAt).toLocaleTimeString("en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {tx.paymentMethod && (
                        <span className="hidden sm:inline">
                          via {tx.paymentMethod}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right Section - Amount */}
                  <div className="flex items-center justify-between md:justify-end gap-4 md:flex-col md:items-end">
                    <p
                      className={`font-bold text-lg md:text-xl ${getTypeColor(
                        tx.type
                      )}`}
                    >
                      {tx.type === "DEPOSIT" || tx.type === "REFUND"
                        ? "+"
                        : "-"}
                      ₦{Number(tx.amount).toLocaleString()}
                    </p>
                    <div className="text-xs text-muted-foreground text-right hidden md:block">
                      <p>
                        Balance: ₦{Number(tx.balanceAfter).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Mobile Balance Info */}
                <div className="mt-2 pt-2 border-t flex justify-between text-xs text-muted-foreground md:hidden">
                  <span>
                    Before: ₦{Number(tx.balanceBefore).toLocaleString()}
                  </span>
                  <span>
                    After: ₦{Number(tx.balanceAfter).toLocaleString()}
                  </span>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <Card className="p-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              {/* Page Info */}
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.pages} ({pagination.total}{" "}
                total)
              </p>

              {/* Pagination Controls */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(pagination.page - 1)}
                  disabled={pagination.page === 1}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  <span className="hidden sm:inline">Previous</span>
                </Button>

                {/* Page Numbers - Desktop */}
                <div className="hidden sm:flex items-center gap-1">
                  {[...Array(Math.min(5, pagination.pages))].map((_, i) => {
                    let pageNum;
                    if (pagination.pages <= 5) {
                      pageNum = i + 1;
                    } else if (pagination.page <= 3) {
                      pageNum = i + 1;
                    } else if (pagination.page >= pagination.pages - 2) {
                      pageNum = pagination.pages - 4 + i;
                    } else {
                      pageNum = pagination.page - 2 + i;
                    }

                    return (
                      <Button
                        key={pageNum}
                        variant={
                          pageNum === pagination.page ? "default" : "outline"
                        }
                        size="sm"
                        onClick={() => handlePageChange(pageNum)}
                        className="w-8 h-8 p-0"
                      >
                        {pageNum}
                      </Button>
                    );
                  })}
                </div>

                {/* Page Numbers - Mobile (Current only) */}
                <div className="sm:hidden">
                  <Button variant="outline" size="sm" className="w-8 h-8 p-0">
                    {pagination.page}
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(pagination.page + 1)}
                  disabled={pagination.page === pagination.pages}
                >
                  <span className="hidden sm:inline">Next</span>
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      <TransactionsContent />
    </Suspense>
  );
}
