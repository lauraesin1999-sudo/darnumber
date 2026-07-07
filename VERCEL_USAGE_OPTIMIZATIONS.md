# Vercel Usage Optimizations (Fast Origin Transfer + Fluid Active CPU)

Goal: At least 50% reduction in billable usage (primarily FOT 30GB+ and Active CPU 7h+).

## Key Changes Made

### 1. Public + Heavily CDN-Cached Services Catalog (Biggest FOT win)
- Made `/api/orders/services` auth **optional** (catalog data is not user-specific).
- Added `export const revalidate = 3600` + strong `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`.
- Created dedicated `/api/public/services` as clean public entrypoint.
- Updated frontend `api.getAvailableServices()` to use **direct unauthenticated fetch** to the public catalog.
  - Removes Authorization header → allows Vercel edge to cache once and serve globally.
- Result: Frequent "Buy Numbers" / catalog loads now hit CDN for most users after first per-PoP. Previously every load hit origin + transferred large JSON.

### 2. Sub-caching of expensive provider fetches inside catalog build (CPU win)
- Raw SMS-Man and TextVerified service lists now cached in Redis for 2 hours.
- Rebuilds of the aggregator skip the slow external API calls when sub-cache is fresh.
- Combined with TTL bump to 90min for main catalog.

### 3. Redis caching on high-frequency user endpoints
- `/user/balance` — 45s cache
- `/user/stats` — 120s cache (multiple heavy groupBy + aggregates)
- `/api/orders` (user order lists + filters) — 45s per user+page+filter
- `/api/users/transactions` — 60s
- Admin dashboard analytics (`/admin/dashboard`) — 5 min cache
- Automatic invalidation on order creation for balance + stats.

These cover the repeated dashboard reloads, list views, and stats that were causing repeated full function executions + response transfers.

### 4. Prefetch discipline
- All dashboard and admin sidebar `<Link>` now use `prefetch={false}`.
- Prevents background origin hits for every nav item (common hidden FOT source in Next.js apps).

### 5. Other
- Exchange rates route: revalidate + Cache-Control.
- Order creation now explicitly busts relevant user caches.
- Many list endpoints already had good pagination; kept/enhanced.

## Expected Impact
- **Fast Origin Transfer**: 60-90%+ reduction on catalog traffic (the 30GB culprit). Catalog is large JSON served on nearly every buy flow.
- **Active CPU**: 50%+ reduction because:
  - Fewer invocations of heavy aggregator (longer + sub caches).
  - Expensive external fetches skipped most of the time.
  - Stats/orders/tx/dashboard now hit Redis instead of full Prisma + compute.
- Other metrics (invocations, Edge Requests) will also drop.

## How to Verify
1. Deploy.
2. In Vercel → Usage (30d view) watch Fast Origin Transfer and Fluid Active CPU charts.
3. Look at "Top paths" — /api/public/services or /api/orders/services and /user/* should show big improvement in ratio of cached vs origin.
4. Test buy flow + dashboard reloads (should feel snappy too).

## Further Wins (if still over)
- Add client-side SWR/React Query with longer staleTime on top of server caches.
- Split the services payload (summary + on-demand details for specific services).
- Move more admin/user list heavy lifting to background jobs or materialized views.
- Consider Edge runtime for ultra-light endpoints.
- Set usage alerts + consider Pro plan for headroom while optimizing.

These changes were made directly in the codebase (no upgrade required).
