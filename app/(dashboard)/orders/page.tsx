"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Copy,
  Frown,
  Search,
  X,
  Filter,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { logger } from "@/lib/logger";

const ORDER_STATUSES = [
  { value: "all", label: "All Statuses" },
  { value: "PENDING", label: "Pending" },
  { value: "WAITING_SMS", label: "Waiting SMS" },
  { value: "COMPLETED", label: "Completed" },
  { value: "FAILED", label: "Failed" },
  { value: "EXPIRED", label: "Expired" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "REFUNDED", label: "Refunded" },
];

export default function OrdersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [page, setPage] = useState(1);

  // Filter states
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to first page on search
    }, 500);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getOrders(page, 20, {
        status: status !== "all" ? status : undefined,
        search: debouncedSearch || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setOrders(response.data);
      setPagination(response.pagination);
    } catch (error: any) {
      logger.error("Failed to fetch orders:", error);
      if (error.response?.status === 401) {
        toast.auth.sessionExpired();
        router.push("/login");
      } else {
        toast.error("Failed to load orders", "Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  }, [page, status, debouncedSearch, startDate, endDate]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleStatusChange = (value: string) => {
    setStatus(value);
    setPage(1);
  };

  const handleDateChange = (type: "start" | "end", value: string) => {
    if (type === "start") {
      setStartDate(value);
    } else {
      setEndDate(value);
    }
    setPage(1);
  };

  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setStartDate("");
    setEndDate("");
    setPage(1);
  };

  const hasActiveFilters = search || status !== "all" || startDate || endDate;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-green-500";
      case "WAITING_SMS":
        return "bg-yellow-500";
      case "PENDING":
        return "bg-blue-500";
      case "FAILED":
      case "EXPIRED":
        return "bg-red-500";
      case "CANCELLED":
      case "REFUNDED":
        return "bg-gray-500";
      default:
        return "bg-gray-500";
    }
  };

  // Generate page numbers for pagination
  const getPageNumbers = () => {
    const totalPages = pagination.pages || 1;
    const current = page;
    const pages: (number | string)[] = [];

    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      if (current <= 3) {
        pages.push(1, 2, 3, 4, "...", totalPages);
      } else if (current >= totalPages - 2) {
        pages.push(
          1,
          "...",
          totalPages - 3,
          totalPages - 2,
          totalPages - 1,
          totalPages
        );
      } else {
        pages.push(
          1,
          "...",
          current - 1,
          current,
          current + 1,
          "...",
          totalPages
        );
      }
    }
    return pages;
  };

  return (
    <div className="w-full">
      <div className="container mx-auto p-4 md:p-6 space-y-4 md:space-y-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <h1 className="text-2xl md:text-3xl font-bold">My Orders</h1>
          <Button
            onClick={() => router.push("/orders/new")}
            className="w-full sm:w-auto"
          >
            Buy Number
          </Button>
        </div>

        {/* Search and Filter Section */}
        <Card className="p-4">
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by order #, phone, service, or code..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Select value={status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Status" />
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
                  size="icon"
                  onClick={() => setShowFilters(!showFilters)}
                  className={showFilters ? "bg-accent" : ""}
                >
                  <Filter className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Advanced Filters */}
            {showFilters && (
              <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t">
                <div className="flex-1">
                  <label className="text-sm text-muted-foreground mb-1 block">
                    From Date
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => handleDateChange("start", e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm text-muted-foreground mb-1 block">
                    To Date
                  </label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => handleDateChange("end", e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Active Filters */}
            {hasActiveFilters && (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
                <span className="text-sm text-muted-foreground">Filters:</span>
                {search && (
                  <Badge variant="secondary" className="gap-1">
                    Search: {search}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setSearch("")}
                    />
                  </Badge>
                )}
                {status !== "all" && (
                  <Badge variant="secondary" className="gap-1">
                    Status:{" "}
                    {ORDER_STATUSES.find((s) => s.value === status)?.label}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setStatus("all")}
                    />
                  </Badge>
                )}
                {startDate && (
                  <Badge variant="secondary" className="gap-1">
                    From: {startDate}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setStartDate("")}
                    />
                  </Badge>
                )}
                {endDate && (
                  <Badge variant="secondary" className="gap-1">
                    To: {endDate}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setEndDate("")}
                    />
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-6 text-xs"
                >
                  Clear all
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Results count */}
        {!loading && pagination.total !== undefined && (
          <p className="text-sm text-muted-foreground">
            {pagination.total} {pagination.total === 1 ? "order" : "orders"}{" "}
            found
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner />
          </div>
        ) : orders.length === 0 ? (
          <Card className="p-8 md:p-12 text-center">
            <Frown className="mx-auto mb-2 text-muted-foreground" size={48} />
            <p className="text-muted-foreground mb-4 text-sm md:text-base">
              {hasActiveFilters
                ? "No orders match your filters"
                : "No orders yet"}
            </p>
            <div className="flex justify-center gap-2">
              {hasActiveFilters ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear Filters
                </Button>
              ) : (
                <Button
                  onClick={() => router.push("/orders/new")}
                  className="w-50 sm:w-auto"
                >
                  Buy Your First Number
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:gap-4">
              {orders.map((order) => (
                <Card
                  key={order.id}
                  className="p-4 md:p-6 hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => router.push(`/orders/${order.id}`)}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="space-y-2 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base md:text-lg font-semibold truncate">
                          {order.serviceCode.toUpperCase()}
                        </h3>
                        <Badge className={getStatusColor(order.status)}>
                          {order.status}
                        </Badge>
                      </div>
                      <p className="text-xs md:text-sm text-muted-foreground truncate">
                        Order #{order.orderNumber}
                      </p>
                      {order.phoneNumber && (
                        <div className="flex items-center gap-2">
                          <p className="text-xs md:text-sm font-mono break-all">
                            {order.phoneNumber}
                          </p>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(order.phoneNumber);
                            }}
                            aria-label="Copy phone number"
                          >
                            <Copy className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                      {order.smsCode && (
                        <p className="text-base md:text-lg font-bold text-green-600">
                          Code: {order.smsCode}
                        </p>
                      )}
                    </div>
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start sm:text-right space-y-0 sm:space-y-2">
                      <p className="text-xl md:text-2xl font-bold">
                        ₦ {order.finalPrice}
                      </p>
                      <p className="text-xs md:text-sm text-muted-foreground">
                        {new Date(order.createdAt).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            {/* Enhanced Pagination */}
            {pagination.pages > 1 && (
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-4">
                <p className="text-sm text-muted-foreground order-2 sm:order-1">
                  Showing {(page - 1) * 20 + 1} -{" "}
                  {Math.min(page * 20, pagination.total)} of {pagination.total}
                </p>
                <div className="flex items-center gap-1 order-1 sm:order-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-1">
                    {getPageNumbers().map((p, i) =>
                      p === "..." ? (
                        <span
                          key={`ellipsis-${i}`}
                          className="px-2 text-muted-foreground"
                        >
                          ...
                        </span>
                      ) : (
                        <Button
                          key={p}
                          variant={page === p ? "default" : "outline"}
                          size="icon"
                          onClick={() => setPage(p as number)}
                          className="w-9 h-9"
                        >
                          {p}
                        </Button>
                      )
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={page === pagination.pages}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
