import Redis from "ioredis";

export class RedisService {
  private client: Redis;
  private isConnected = false;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy: (times) => Math.min(times * 50, 2000),
      reconnectOnError: (err) => err.message.includes("READONLY"),
    });

    this.client.on("connect", () => {
      this.isConnected = true;
      console.log("✅ Redis connected");
    });
    this.client.on("error", (error) => {
      this.isConnected = false;
      console.error("❌ Redis error:", error);
    });
  }

  async get(key: string) {
    try {
      return await this.client.get(key);
    } catch (e) {
      console.error(`Redis GET error for key ${key}:`, e);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number) {
    try {
      if (ttl) await this.client.setex(key, ttl, value);
      else await this.client.set(key, value);
    } catch (e) {
      console.error(`Redis SET error for key ${key}:`, e);
    }
  }

  async del(...keys: string[]) {
    try {
      return await this.client.del(...keys);
    } catch (e) {
      console.error("Redis DEL error:", e);
      return 0;
    }
  }

  async exists(key: string) {
    try {
      return (await this.client.exists(key)) === 1;
    } catch (e) {
      console.error("Redis EXISTS error:", e);
      return false;
    }
  }

  async expire(key: string, seconds: number) {
    try {
      await this.client.expire(key, seconds);
    } catch (e) {
      console.error("Redis EXPIRE error:", e);
    }
  }

  async keys(pattern: string) {
    try {
      return await this.client.keys(pattern);
    } catch (e) {
      console.error("Redis KEYS error:", e);
      return [];
    }
  }

  async getOrderStatus(orderId: string) {
    const key = `order:status:${orderId}`;
    const cached = await this.get(key);
    return cached ? JSON.parse(cached) : null;
  }
  async setOrderStatus(orderId: string, status: any, ttl = 300) {
    const key = `order:status:${orderId}`;
    await this.set(key, JSON.stringify(status), ttl);
  }
  async invalidateOrder(orderId: string) {
    const key = `order:status:${orderId}`;
    await this.del(key);
  }

  async invalidateUserBalance(userId: string) {
    const key = `user:balance:${userId}`;
    await this.del(key);
  }

  // Generic helpers for JSON caching
  async getJSON<T>(key: string): Promise<T | null> {
    const cached = await this.get(key);
    if (!cached) return null;
    try {
      return JSON.parse(cached) as T;
    } catch {
      return null;
    }
  }

  async setJSON(key: string, value: unknown, ttlSeconds?: number) {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  // User stats cache (more expensive aggregation)
  async getUserStats(userId: string) {
    return this.getJSON(`user:stats:${userId}`);
  }
  async setUserStats(userId: string, stats: unknown, ttl = 90) {
    await this.setJSON(`user:stats:${userId}`, stats, ttl);
  }
  async invalidateUserStats(userId: string) {
    await this.del(`user:stats:${userId}`);
  }

  // Admin analytics cache (expensive aggregates across whole DB)
  async getAdminDashboard(days: number) {
    return this.getJSON(`admin:dashboard:${days}`);
  }
  async setAdminDashboard(days: number, data: unknown, ttl = 300) { // 5 min
    await this.setJSON(`admin:dashboard:${days}`, data, ttl);
  }
  async invalidateAdminDashboard() {
    const keys = await this.keys("admin:dashboard:*");
    if (keys.length) await this.del(...keys);
  }

  // Raw provider service lists (expensive external calls)
  async getProviderServices(provider: string) {
    return this.getJSON<any[]>(`provider:services:${provider}`);
  }
  async setProviderServices(provider: string, services: any[], ttl = 7200) { // 2 hours
    await this.setJSON(`provider:services:${provider}`, services, ttl);
  }

  // User-scoped lists (short TTL because they change but repeated loads happen)
  async getUserOrders(userId: string, page: number, limit: number, filterKey: string) {
    return this.getJSON(`user:orders:${userId}:${page}:${limit}:${filterKey}`);
  }
  async setUserOrders(userId: string, page: number, limit: number, filterKey: string, data: unknown, ttl = 45) {
    await this.setJSON(`user:orders:${userId}:${page}:${limit}:${filterKey}`, data, ttl);
  }

  async getUserTransactions(userId: string, page: number, limit: number, filterKey: string) {
    return this.getJSON(`user:tx:${userId}:${page}:${limit}:${filterKey}`);
  }
  async setUserTransactions(userId: string, page: number, limit: number, filterKey: string, data: unknown, ttl = 60) {
    await this.setJSON(`user:tx:${userId}:${page}:${limit}:${filterKey}`, data, ttl);
  }
}

let redisInstance: RedisService | null = null;
export function getRedisService() {
  if (!redisInstance) redisInstance = new RedisService();
  return redisInstance;
}
