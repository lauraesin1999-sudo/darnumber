// ============================================
// API CLIENT - Axios Configuration
// ============================================

import axios, { AxiosError, AxiosInstance } from "axios";

const API_BASE_URL = "/api";

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 60000,
    });

    // Request interceptor - add auth token
    this.client.interceptors.request.use(
      (config) => {
        const token = this.getToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error),
    );

    // Response interceptor - handle errors
    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError<any>) => {
        if (error.response?.status === 401) {
          this.clearAuth();
          if (typeof window !== "undefined") window.location.href = "/login";
        }
        return Promise.reject(error);
      },
    );
  }

  private getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("accessToken");
  }

  private getRefreshToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("refreshToken");
  }

  private setTokens(accessToken: string, refreshToken: string): void {
    if (typeof window === "undefined") return;
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
  }

  private clearAuth(): void {
    if (typeof window === "undefined") return;
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
  }

  private async refreshToken(): Promise<boolean> {
    return false;
  }

  // ============================================
  // AUTH METHODS
  // ============================================

  async register(data: {
    email: string;
    password: string;
    userName: string;
    phone?: string;
    country?: string;
    referralCode?: string;
  }) {
    const response = await this.client.post("/auth/register", data);
    return response.data;
  }

  async login(email: string, password: string) {
    const response = await this.client.post("/auth/login", { email, password });
    if (response.data.success) {
      this.setTokens(
        response.data.data.accessToken,
        response.data.data.refreshToken,
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("user", JSON.stringify(response.data.data.user));
      }
    }
    return response.data;
  }

  async logout() {
    try {
      await this.client.post("/auth/logout");
    } finally {
      this.clearAuth();
    }
  }

  async getCurrentUser() {
    const response = await this.client.get("/auth/me");
    return response.data;
  }

  async changePassword(currentPassword: string, newPassword: string) {
    const response = await this.client.post("/auth/password/change", {
      currentPassword,
      newPassword,
    });
    return response.data;
  }

  async requestPasswordReset(email: string) {
    const response = await this.client.post("/auth/password-reset/request", {
      email,
    });
    return response.data;
  }

  // Shims for components referencing legacy names
  async resetPassword(token: string, newPassword: string) {
    const response = await this.client.post("/auth/password/reset", {
      token,
      newPassword,
    });
    return response.data;
  }

  // ============================================
  // ORDER METHODS
  // ============================================

  async createOrder(data: {
    serviceCode: string;
    country: string;
    provider?: string;
    price: number;
  }) {
    console.log("API Client - Creating order:", data);
    const response = await this.client.post("/orders", data);
    console.log("API Client - Order response:", response.data);
    return response.data;
  }

  async getOrders(
    page: number = 1,
    limit: number = 20,
    filters?: {
      status?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const response = await this.client.get("/orders", {
      params: {
        page,
        limit,
        ...(filters?.status &&
          filters.status !== "all" && { status: filters.status }),
        ...(filters?.search && { search: filters.search }),
        ...(filters?.startDate && { startDate: filters.startDate }),
        ...(filters?.endDate && { endDate: filters.endDate }),
      },
    });
    // Backend returns {ok: true, data: {orders: [], pagination: {}}}
    return {
      data: response.data.data?.orders || [],
      pagination: response.data.data?.pagination || {},
    };
  }

  async getOrder(orderId: string) {
    const response = await this.client.get(`/orders/${orderId}`);
    return response.data;
  }

  async cancelOrder(orderId: string) {
    const response = await this.client.post(`/orders/${orderId}/cancel`);
    return response.data;
  }

  async getAvailableServices(country?: string, serviceCode?: string) {
    // Use the dedicated PUBLIC catalog endpoint.
    // This endpoint has long-lived CDN caching (s-maxage) and no auth requirement.
    // Primary optimization for Fast Origin Transfer — repeated "Buy Numbers" loads
    // now mostly served from edge instead of invoking origin compute.
    const origin =
      typeof window !== "undefined"
        ? window.location.origin
        : process.env.NEXT_PUBLIC_VERCEL_URL || "http://localhost:3000";
    const url = new URL("/api/public/services", origin);
    // Note: the public catalog is not filtered server-side by country/serviceCode here;
    // client filters as before (or enhance public route later). The main aggregator
    // still supports query params if needed for backward.
    if (country) url.searchParams.set("country", country);
    if (serviceCode) url.searchParams.set("serviceCode", serviceCode);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // match previous 120s tolerance for cold builds
    try {
      const res = await fetch(url.toString(), {
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        // No Authorization on purpose for maximum shared cache hits
      });
      if (!res.ok) {
        const err: any = new Error("Failed to load services");
        err.response = { status: res.status };
        throw err;
      }
      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  // Provider-specific service fetchers (client-side filter from aggregated data)
  async getSmsManServices(country?: string, serviceCode?: string) {
    const data = await this.getAvailableServices(country, serviceCode);
    const services = (data?.data?.services || []).filter((s: any) =>
      (s.providers || []).some(
        (p: any) => p.name === "sms-man" || p.id === "lion",
      ),
    );
    return { ok: true, data: { services } };
  }

  async getTextVerifiedServices(country?: string, serviceCode?: string) {
    const data = await this.getAvailableServices(country, serviceCode);
    const services = (data?.data?.services || []).filter((s: any) =>
      (s.providers || []).some(
        (p: any) => p.name === "textverified" || p.id === "panda",
      ),
    );
    return { ok: true, data: { services } };
  }

  async getAvailableProvidersForService(serviceCode: string, country: string) {
    const response = await this.client.get("/orders/services/available", {
      params: { country, serviceCode },
    });
    return response.data;
  }

  async getTextVerifiedPrice(serviceName: string) {
    const response = await this.client.get(
      `/providers/textverified/price?serviceName=${serviceName}`,
    );
    return response.data;
  }

  // ============================================
  // USER METHODS
  // ============================================

  async getProfile() {
    const response = await this.client.get("/users/profile");
    return response.data;
  }

  async updateProfile(data: {
    userName?: string;
    phone?: string;
    country?: string;
  }) {
    const response = await this.client.patch("/users/profile", data);
    return response.data;
  }

  async getBalance() {
    const response = await this.client.get("/user/balance");
    return response.data;
  }

  async getTransactions(
    page: number = 1,
    limit: number = 20,
    filters?: {
      search?: string;
      type?: string;
      status?: string;
    },
  ) {
    const params: any = { page, limit };
    if (filters?.search) params.search = filters.search;
    if (filters?.type) params.type = filters.type;
    if (filters?.status) params.status = filters.status;

    const response = await this.client.get("/users/transactions", { params });
    // Backend returns {ok: true, data: {transactions: [], pagination: {}}}
    return {
      data: response.data.data?.transactions || [],
      pagination: response.data.data?.pagination || {},
    };
  }

  async updateBankDetails(data: {
    bankAccount: string;
    accountNumber: string;
    bankName: string;
  }) {
    const response = await this.client.patch("/users/bank-details", data);
    return response.data;
  }

  async getReferrals() {
    const response = await this.client.get("/users/referrals");
    return response.data;
  }

  async getUserStats() {
    const response = await this.client.get("/user/stats");
    return response.data;
  }

  async getActivity(page: number = 1, limit: number = 20) {
    const response = await this.client.get("/users/activity", {
      params: { page, limit },
    });
    return response.data;
  }

  // ============================================
  // PAYMENT METHODS
  // ============================================

  // Nigerian Payment Providers
  async getPaymentProviders() {
    const response = await this.client.get("/payments/providers");
    return response.data;
  }

  async initializePayment(amount: number, provider: string) {
    const response = await this.client.post("/payments/initialize", {
      amount,
      provider,
    });
    return response.data;
  }

  async verifyPayment(reference: string, provider: string) {
    const response = await this.client.get(
      `/payments/verify/${reference}?provider=${provider}`,
    );
    return response.data;
  }

  async requestWithdrawal(amount: number, bankDetails: any) {
    const response = await this.client.post("/payments/withdraw", {
      amount,
      bankDetails,
    });
    return response.data;
  }

  async getPaymentHistory(page: number = 1, limit: number = 20) {
    const response = await this.client.get("/payments/history", {
      params: { page, limit },
    });
    return response.data;
  }

  async requestPaystackDedicatedAccount(preferredBank?: string) {
    const response = await this.client.post(
      "/payments/paystack/dedicated-account",
      preferredBank ? { preferredBank } : {},
    );
    return response.data;
  }

  // ============================================
  // ADMIN METHODS
  // ============================================

  async getDashboard(days: number = 30) {
    const response = await this.client.get("/admin/dashboard", {
      params: { days },
    });
    return response.data;
  }

  // Legacy alias used in admin page
  async getAdminDashboard() {
    return this.getDashboard();
  }

  async getUsers(params?: {
    search?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const response = await this.client.get("/admin/users", { params });
    return response.data;
  }

  // Legacy alias used in admin users page
  async getAdminUsers(page?: number, limit?: number, search?: string) {
    return this.getUsers({ page, limit, search });
  }

  async getUserDetails(userId: string) {
    const response = await this.client.get(`/admin/users/${userId}`);
    return response.data;
  }

  async updateUser(userId: string, data: any) {
    const response = await this.client.patch(`/admin/users/${userId}`, data);
    return response.data;
  }

  async adjustBalance(userId: string, amount: number, reason: string) {
    const response = await this.client.post(
      `/admin/users/${userId}/adjust-balance`,
      { amount, reason },
    );
    return response.data;
  }

  // Legacy alias used in admin users page
  async adjustUserBalance(userId: string, amount: number, reason: string) {
    return this.adjustBalance(userId, amount, reason);
  }

  async getAdminOrders(params?: any) {
    const response = await this.client.get("/admin/orders", { params });
    return response.data;
  }

  async getOrderStats(startDate?: string, endDate?: string) {
    const response = await this.client.get("/admin/orders/stats", {
      params: { startDate, endDate },
    });
    return response.data;
  }

  async getPricingRules() {
    const response = await this.client.get("/admin/pricing-rules");
    return response.data;
  }

  async createPricingRule(data: any) {
    const response = await this.client.post("/admin/pricing-rules", data);
    return response.data;
  }

  async updatePricingRule(ruleId: string, data: any) {
    const response = await this.client.patch(
      `/admin/pricing-rules/${ruleId}`,
      data,
    );
    return response.data;
  }

  async deletePricingRule(ruleId: string) {
    const response = await this.client.delete(`/admin/pricing-rules/${ruleId}`);
    return response.data;
  }

  async getProviders() {
    const response = await this.client.get("/admin/providers");
    return response.data;
  }

  async updateProvider(providerId: string, data: any) {
    const response = await this.client.patch(
      `/admin/providers/${providerId}`,
      data,
    );
    return response.data;
  }

  async syncProvider(providerId: string) {
    const response = await this.client.post(
      `/admin/providers/${providerId}/sync`,
    );
    return response.data;
  }

  async getActivityLogs(params?: any) {
    const response = await this.client.get("/admin/logs/activity", { params });
    return response.data;
  }

  async getSystemLogs(params?: any) {
    const response = await this.client.get("/admin/logs/system", { params });
    return response.data;
  }

  // Admin Transactions
  async getAdminTransactions(params?: {
    page?: number;
    limit?: number;
    type?: string;
    status?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const response = await this.client.get("/admin/transactions", { params });
    return response.data;
  }

  // Admin Wallets
  async getAdminWallets(params?: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
  }) {
    const response = await this.client.get("/admin/wallets", { params });
    return response.data;
  }

  // Admin Order Actions
  async adminCancelOrder(orderId: string) {
    const response = await this.client.post(`/admin/orders/${orderId}/cancel`);
    return response.data;
  }

  async refundOrder(orderId: string, reason?: string) {
    const response = await this.client.post(`/admin/orders/${orderId}/refund`, {
      reason,
    });
    return response.data;
  }
}

export const api = new ApiClient();
export default api;
