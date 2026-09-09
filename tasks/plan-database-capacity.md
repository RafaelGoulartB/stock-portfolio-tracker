# Database Capacity, Transfer, and Logo Request Plan

## Purpose

Keep the PostgreSQL database comfortably below a 500 MB storage quota and
reduce database and application transfer under heavy use.

This document separates three limits that hosting providers may account for
differently:

- PostgreSQL storage: tables, indexes, TOAST data, and database metadata.
- Database transfer: query results sent from PostgreSQL to the API.
- Application transfer: API responses sent to the browser and traffic between
  the API and external quote, dividend, and FX providers.

The provider and plan must be checked before treating these estimates as quota
billing figures. Providers differ on whether WAL, backups, replicas, and
traffic inside the same region count toward their limits.

## Review scope and evidence (2026-09-07)

This review inspected the current source and installed TanStack Query code,
checked Logo.dev's public documentation, and ran read-only size/statistics
queries against the configured Neon database on 2026-09-07. No production
traffic was measured. The benchmark below is retained from the earlier study;
it was not rerun against today's schema. The owner confirmed Neon as the
provider during this review; the account's actual plan and usage have not been
inspected.
The 500 MB budget corresponds to the public Free plan's 0.5 GB allowance.

The highest-confidence opportunity is reducing database result traffic:
ordinary navigation and small writes repeatedly select the full account
ledger. Logo images already bypass both the API and PostgreSQL, but their
browser cache is temporary, not a permanent download-once implementation.

The current database measured 8,429,568 bytes (8,232 kB), about 1.6% of the
public Free-plan 0.5 GB storage allowance. `pg_stat_user_tables` reported 32
live transaction rows and 24 dead transaction rows; the largest relations were
each 64 kB. These counters are approximate and do not measure network transfer,
but they confirm storage and bloat are not the present operational constraint.
The migration-created baseline is most of the current size. Recheck after a
material import or sustained production use.

### Neon-specific implications

The public Free plan currently includes 0.5 GB storage per project, 100
CU-hours per project per month, and 5 GB public network transfer per project
per month. Check the account console for its actual entitlement and remaining
usage. Sources checked on 2026-09-07: [Neon pricing](https://neon.com/pricing)
and [network transfer](https://neon.com/docs/introduction/network-transfer).

Neon counts outbound database traffic through its proxy, including both direct
and pooled connections. The important path here is PostgreSQL to the API;
compressing browser JSON or changing logo delivery does not reduce that meter.
Backup exports also read account data through this path. At the earlier
estimate of 2.1 MB per 10,000-row ledger read, 5 GB corresponds to roughly
2,380 such reads, or 79 per day over 30 days, before protocol overhead and all
other queries. Multiple full-history queries per screen can consume that
allowance sooner; this is illustrative arithmetic, not observed usage.

Neon Free suspends inactive compute after five minutes. Therefore, auditing
the deployment's `/health` polling is an immediate priority alongside query
pagination: this app's health route executes SQL, so frequent polling can
prevent scale-to-zero even when nobody uses the portfolio. A constant 0.25 CU
for 30 days would use 180 CU-hours; that is a conditional example, not the
configured compute size. Use process liveness for frequent platform probes and
retain a separate database readiness check with deliberate frequency. Do not
introduce a frequent SQL timer solely to remove expired sessions; prefer
rate-limited cleanup on actual session issuance or an infrequent scheduled
maintenance window. Source: [Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero).

## Current persistence model

The application persists only:

- users and sessions;
- transactions;
- allocation assets;
- quarterly asset reviews;
- categories and asset-category assignments;
- the current cash balance and per-user score and contribution-plan policies.

Spot quotes, historical price series, dividend events, FX rates, portfolio
positions, and performance snapshots are fetched or calculated on demand and
are not stored. This is favorable for the storage quota.

## PostgreSQL 16 benchmark

The migrations present at the time of the earlier benchmark were applied to a
temporary PostgreSQL 16.15 database. Later schema additions require a new
measurement before using these figures as current physical capacity.
Measurements used `pg_total_relation_size`, so they include the table, indexes,
and TOAST auxiliary storage.

The empty migrated database used approximately 8.2 MB.

| Record | Measured physical storage |
| --- | ---: |
| Transaction without notes | 192 bytes |
| Typical transaction | 272 bytes |
| Transaction with the 280-character note limit | 477 bytes |
| Review without text fields | 234 bytes |
| Typical review | 489 bytes |
| Review with notes and reference near their limits | 5.83 KB |
| Allocation asset | 218 bytes |
| Asset-category assignment | 209 bytes |
| Category | 270 bytes |
| Session | 369 bytes |

The representative large dataset used:

- 1,000,000 typical transactions: 272 MB;
- 200,000 typical reviews: 97.8 MB;
- 10,000 allocation assets: 2.18 MB;
- 10,000 asset-category assignments: 2.09 MB;
- complete database: approximately 383 MB.

These are estimates rather than contractual limits. Text compressibility,
index page utilization, database bloat, PostgreSQL settings, and future schema
changes can alter the result.

## Capacity scenarios

### Heavy personal use

Assumptions:

- 100 tracked assets;
- five transactions per business day, or 1,260 per year;
- one quarterly review per asset, or 400 per year;
- normal-length notes;
- a small number of new sessions.

Estimated steady growth is approximately 0.52 MB per year. After ten years,
the database should use roughly 13 to 15 MB including the initial database
overhead.

### Deliberately pessimistic stress case

Assumptions:

- 200 tracked assets;
- twenty transactions per business day, or 5,040 per year;
- maximum-size notes on every transaction;
- 800 reviews per year;
- maximum-size review notes and references;
- ten new sessions per day with no expired-session cleanup.

Estimated growth is approximately 8 MB per year. This case is intentionally
unrealistic and would still remain well below 500 MB for a single user over ten
years.

### Multi-user effect

Storage becomes relevant when the application is offered to many users:

- 100 users following the heavy personal scenario add about 52 MB per year;
- 10 users following the pessimistic scenario add about 80 MB per year.

## Operating thresholds

Do not plan to consume the full 500 MB. Updates and deletes create obsolete row
versions, migrations may temporarily duplicate data, and maintenance operations
can require additional working space.

Use these thresholds:

- 300 MB: warning and growth-rate review;
- 350 MB: mandatory capacity action;
- 400 MB: operational ceiling;
- 100 MB: reserved headroom for bloat, migrations, and maintenance.

At the 350 MB action threshold, after initial database overhead, there is room
for approximately:

- 1.25 million typical transactions if they were the only growing data; or
- 716,000 maximum-note transactions if they were the only growing data.

Review text can materially reduce capacity. A review with both text fields near
their maximum measured approximately 5.83 KB.

## Transfer findings

A representative selected transaction used approximately 210 bytes on the
PostgreSQL-to-API path. Its uncompressed JSON representation used approximately
347 bytes on the API-to-browser path.

| Transaction history | Full DB-to-API read | Transaction-list JSON |
| ---: | ---: | ---: |
| 1,000 | 210 KB | 347 KB |
| 10,000 | 2.1 MB | 3.47 MB |
| 100,000 | 21 MB | 34.7 MB |

Several routes call `loadTransactions` and therefore read the user's complete
transaction history:

- transaction list and transaction creation;
- positions and daily tracking;
- allocation;
- performance;
- dividends and finder views.

At 10,000 transactions, twenty full-history page loads per day produce roughly
1.26 GB of database-to-API result traffic per 30-day month, before browser and
external-provider traffic.

### Quadratic transaction-creation traffic

`transactions.create` currently loads the complete history before every insert
to validate ticker currency and available quantity. When the Transactions page
receives the mutation result, it invalidates and reloads the complete list.

When records are entered individually from an empty database, the approximate
cumulative database-to-API read is:

| Individually created transactions | Cumulative DB-to-API read |
| ---: | ---: |
| 1,000 | 210 MB |
| 5,000 | 5.25 GB |
| 10,000 | 21 GB |

Final storage for 10,000 typical transactions is only about 2.7 MB. Transfer is
therefore the earlier constraint. Batch opening-balance import is much more
efficient because it performs one history validation for the batch.

## Improvement plan

### P0: Bound transaction-creation reads

Replace the full `loadTransactions(userId)` call in transaction creation with
queries scoped to the affected ticker.

The initial scope reduction needs only that ticker's ledger, including:

- the currencies already used by that user's ticker; and
- the chronologically ordered quantities needed to validate a sale at its
  ledger position, including the effect on subsequent transactions.

Do not replace chronological validation with a final net-quantity aggregate:
a backdated sale can leave a negative intermediate balance despite a positive
current balance. Today validation reads occur before the write transaction
and `availableQuantity` checks the net balance. Treat backdated and concurrent
writes as correctness requirements of this work, using atomic validation and
appropriate per-account/ticker serialization. Keep financial rules in the
domain layer. Apply scoped reads to `bookHoldings` (the batch's tickers) and
`allocation.setManualValue` (one ticker) as well.

Acceptance criteria:

- creating a transaction does not select unrelated tickers;
- query result size depends on one ticker rather than the complete portfolio;
- mixed-currency protection and overselling protection remain covered by tests;
- backdated trades and concurrent sales cannot create invalid ledger balances;
- a benchmark with 10,000 unrelated transactions shows a bounded validation
  result.

### P0: Paginate the transaction list

Add cursor-based or stable offset pagination to `transactions.list`. Default to
at most 100 rows per page and return a separate total count only when required.

Ordering must remain deterministic, using `traded_at`, `created_at`, and `id` as
the final tie-breaker.

Acceptance criteria:

- opening the Transactions screen never loads the complete ledger by default;
- users can navigate or progressively load older transactions;
- mutations refresh only the affected first page and relevant summaries;
- response size remains bounded as transaction history grows.

### P1: Limit reviews returned by Allocation

The allocation screen can display a limited quarter window but the API loads
and returns all stored reviews. Add a requested review window, capped at eight
quarters for the main table. Fetch complete history only on the asset detail
screen when it is explicitly needed.

Acceptance criteria:

- allocation list response size is bounded by assets times the quarter cap;
- scoring receives every review required by `DEFAULT_SCORE_CONFIG`;
- use the effective user score policy: `averageGrade` takes the newest N
  **graded** reviews, not N calendar quarters; sparse grades may be older than
  the visible window;
- preserve the latest non-null fair value and its reference even when older
  than the visible window; a simple date cutoff would change discounts;
- asset detail can still access older reviews;
- no scoring threshold is duplicated in a router or screen.

### P1: Reduce repeated full-ledger reads

Review Positions, Daily, Performance, Dividends, Finder, and Allocation. Give
each route the smallest data shape and time range it needs.

Potential approaches, in increasing order of complexity:

1. Select only required columns and relevant dates or tickers.
2. Perform straightforward aggregates in PostgreSQL.
3. Maintain a transactionally updated current-position projection if measured
   scale justifies it.

Do not introduce a projection until query measurements show that scoped reads
and pagination are insufficient. Moving-average cost behavior and one-currency-
per-ticker invariants must remain authoritative in the domain layer.

Concrete reductions in the current code:

- `transactions.ts:loadTransactions` selects `notes` and `id` through the same
  column object as the list DTO. Consolidation does not use notes. Split the
  calculation projection from the display projection; retain identity where
  required to make trade ordering deterministic.
- `allocation.list` loads allocation metadata, then `loadValuedPortfolio`
  reads that table again for manual prices. Pass the already-loaded values
  explicitly, preserving stored-price and client-override precedence.
- `allocation.history` loads all allocation assets to find one ticker. Scope
  that metadata query to the requested ticker.
- `allocation.$ticker.tsx` queries the complete allocation list as well as
  ticker history and ledger. A dedicated detail response can reduce transfer,
  but contribution scores and weights still need portfolio-wide denominators;
  do not calculate a different score from the ticker alone.
- Positions also mounts a Finder query for its chart. Both independently call
  `loadValuedPortfolio`. HTTP batching in `lib/api.ts` reduces HTTP overhead,
  not these repeated SQL reads. Consider request-scoped read deduplication for
  identical account/input reads within a read-only batch after measuring it.

Historical reports need opening balances and cost history before the visible
date range. Pushing an upper `asOf` bound into SQL can be safe; dropping all
transactions before the chart start is not generally safe.

### P1: Match frontend cache lifetime to data freshness

`apps/web/src/lib/api.ts` now sets `staleTime` to 15 minutes and `gcTime` to
one hour, matching the Yahoo delayed-tape window. Focus refetch and retries
stay off. Performance still overrides to 30 minutes; Dividends and FX stay at
six hours. Live screens expose an explicit "Refresh quotes" action so a
longer freshness window does not trap the user on a dead tape.

Mutation invalidation in `routes/_app/transactions.tsx` already covers
`positions.list`, `positions.daily`, `positions.finder`, `allocation.list`,
`performance.history`, `dividends.history`, and `transactions.forTicker`.
Preserve `lib/session.ts` clearing all queries on account changes. Do not
persist private portfolio query caches.

The API also memoizes `loadTransactions` / `loadValuedPortfolio` inside one
HTTP batch via `runWithRequestMemo`, and Yahoo spot quotes batch into a
single upstream request. Provider cache hits still do not persist to
PostgreSQL.

Acceptance: navigating back within 15 minutes performs no new request for the
same live query key; an explicit refresh bypasses that window; mutations
update every affected screen; BRL/USD, absent FX, reload, and account
switching remain correct.

### P1: Clean expired sessions periodically

Expired sessions are currently removed only when the API process starts. A
long-lived process can retain expired rows indefinitely.

Add periodic cleanup or cleanup during session issuance, with a reasonable
rate limit. Consider an index on `expires_at` only after checking the query plan
and session count; the index has its own storage and write cost.

Acceptance criteria:

- expired sessions are removed without requiring a deployment or restart;
- cleanup cannot run concurrently at an excessive rate;
- active sessions and the 30-day TTL behavior remain unchanged.

### P1: Configure the connection pool explicitly

`postgres(env.DATABASE_URL)` uses the Postgres.js default maximum of ten
connections per API process. Multiple API instances multiply this number.

Add validated environment settings for a deliberately small pool. For a small
deployment, start with two or three connections per API instance and increase
only from measured concurrency and latency. Configure an idle timeout suitable
for the hosting provider or its pooler.

This is especially important if the stated 500 MB limit is RAM rather than
database storage.

Acceptance criteria:

- maximum connections are explicit and documented;
- total possible connections across all API replicas stay below the provider
  limit;
- normal concurrent dashboard requests complete without connection starvation.

### P2: Add capacity monitoring

Run and record the following queries at least weekly:

```sql
SELECT pg_size_pretty(pg_database_size(current_database()));

SELECT
  relname,
  n_live_tup,
  n_dead_tup,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC;
```

Also record provider-reported transfer, connection count, and retained backup or
WAL usage when those metrics are available.

Alert at 300 MB and estimate time to 350 MB from the recent growth rate rather
than relying only on the current absolute size.

### P2: Measure transfer by route

Add request instrumentation that records, without portfolio values or other
sensitive payloads:

- route name;
- response byte count;
- query duration;
- selected row count where practical;
- external-provider request count and response byte count;
- cache hit or miss where applicable.

Use the measurements to identify routes that deserve further query reduction.

### P2: Define retention before persisting market data

Do not add permanent quote, dividend, FX, or daily snapshot tables without a
dedicated retention and aggregation plan. If historical persistence is added,
define:

- sampling frequency;
- retention duration;
- uniqueness keys;
- compression or monthly aggregation;
- deletion and vacuum behavior;
- expected storage and transfer per user-year.

## Logo.dev: current behavior and improvements

Evidence: `apps/web/src/components/asset-logo.tsx` is the shared component used
by portfolio tables and asset detail. It requests `img.logo.dev` directly with
a normalized ticker/exchange identity, stable query parameters, WebP,
`size=64`, `retina=true`, `loading="lazy"`, and asynchronous decoding. Unsupported
asset classes and a missing publishable key already produce local initials.

There is no app-owned logo cache in IndexedDB, Cache Storage, localStorage, or
a service worker in the inspected source. The existing reuse is the browser's
HTTP cache. Logo.dev currently documents 24-hour freshness and a ten-minute
stale-while-revalidate allowance. Expiry, eviction, a different device/profile,
or a changed URL can cause another network request. A component rerender does
not by itself imply another billable request. See
[Logo.dev caching](https://www.logo.dev/docs/platform/caching).

The public Community plan currently lists 500,000 monthly requests; verify the
actual account dashboard before treating that as the project's entitlement.
API credits are a separate meter. Self-hosting is listed for paid plans;
copying images to an API proxy, filesystem, or object store is not the proposed
free-plan solution. The documented browser cache already avoids storing logos
in PostgreSQL. See [pricing](https://www.logo.dev/pricing) and
[self-hosting](https://www.logo.dev/docs/platform/self-hosting).

### P1: Avoid repeated failed-logo attempts

`failedSrc` is local React state. It prevents retry only for that mounted
component; a new instance for the same failed URL tries again, subject to any
HTTP caching of the error response. The current code does not share failure
state between views.

Add a small bounded failure registry keyed by the complete normalized URL,
with a short retry TTL (for example, five minutes) and local initials while
suppressed. A module-level map is enough to cover SPA navigation; persistence
would be a separate decision. Do not permanently blacklist a ticker: image
`onError` cannot distinguish missing logos from offline, quota, or transient
failures. Check the registry before setting `src`; multiple simultaneous first
mounts still need measurement rather than a promise of one request.

Acceptance: navigating to a second view after an image failure does not retry
within the TTL; a later mount can retry after expiry; different URL identities
remain independent; errors never hide ticker text or cause layout shifts.

### P2: Offer optional logo suppression if usage warrants it

A local, reversible “show company logos” preference can eliminate logo
requests entirely when off. Render the existing initials without assigning an
image URL. Keep attribution when required, update English and pt-BR messages,
and verify keyboard behavior. This is the most predictable request-saving
control if the account actually approaches its quota.

Keep stable URLs and lazy loading. Do not preload all tracked logos or append
per-render timestamps. If very large tables are measured, pagination or
virtualization can avoid mounting offscreen images; lazy loading already
helps, so do not introduce virtualization only for hypothetical logo savings.

### P2: Right-size images for bytes, not request count

The component displays 28 CSS pixels but requests size 64 with retina enabled.
Evaluate a smaller shared image variant against sharpness on 1x/2x screens.
Smaller files reduce browser bandwidth, not the number of Logo API requests.
Changing the URL also causes an initial cache miss; avoid unnecessary variants
between screens. No exact byte savings are claimed without image measurements.

Do not assume an indefinite custom browser cache is permitted or needed from
the self-hosting documentation. Any proposed policy beyond the documented
HTTP lifetime needs its own freshness, storage-eviction, and provider-terms
review. No such cache is needed for the initial improvements above.

## Other bounded opportunities

- External providers: Yahoo quotes/series, dividends, and Frankfurter use
  process-local Maps and cache successful responses after the fetch completes.
  Concurrent misses for one key can therefore issue duplicate upstream calls.
  Share in-flight promises by the full provider identity, remove them on both
  success and failure, and bound/prune completed caches. TTL checks alone do
  not remove expired keys that are never visited again. Keep manual fallback
  values out of shared public quote entries and retain failure distinctions.
  This saves provider traffic and memory, not PostgreSQL storage; replicas and
  restarts still have separate cold caches. No Redis or database cache is
  justified by the current evidence.
- `/health` performs `SELECT 1` on each request (`apps/api/src/index.ts`). If
  external monitoring polls every 30 seconds, that alone would issue 86,400
  database queries in 30 days per monitor. This is a hypothetical load, not a
  measured deployment setting. Separate process liveness from DB readiness
  only if actual monitoring frequency or provider compute billing justifies it;
  preserve a truthful DB readiness check.
- Existing transaction indexes cover `(user_id, ticker)` and
  `(user_id, traded_at)`. Use these scoped paths first. Evaluate a pagination
  ordering index with `EXPLAIN` before adding it; indexes cost storage and writes.
  A faster query returning the same full ledger does not reduce result bytes.
- HTTP compression, if absent at the deployment proxy, can reduce
  API-to-browser JSON traffic. It does not reduce PostgreSQL-to-API results or
  Logo.dev request counts. Inspect deployment behavior before adding middleware.

## Recommended execution order and measurements

| Order | Change | Main quota affected | Expected result / effort |
| --- | --- | --- | --- |
| 0 | Audit Neon health polling and actual quota consumption | Compute hours | High if frequent SQL probes prevent suspension; deployment configuration remains unverified |
| 1 | Paginate transactions and scope mutation reads | DB and API transfer | High benefit as history grows; medium effort, chronological-write validation needs extra care |
| 2 | Remove unused notes and repeated metadata reads | DB transfer | Low implementation effort; benefit depends on note size and navigation |
| 3 | Complete invalidation, then tune freshness and retention | DB/API requests | Potentially high navigation benefit; medium effort |
| 4 | Bound allocation review payload while preserving scoring inputs | DB/API transfer | High for long review histories; medium effort |
| 5 | Shared temporary logo-failure suppression | Logo requests | Low effort; benefit depends on failed-logo frequency |
| 6 | Session cleanup, explicit pool, provider in-flight deduplication | Storage/connections/provider traffic | Operational hardening; low to medium effort |
| 7 | Optional logo switch, image-size tuning, projections only if justified | Logo requests/bytes or DB transfer | Driven by measured remaining pressure |

The prior estimate gives 3.47 MB JSON for 10,000 transaction rows. At the same
average row size, a 100-row page would be about 34.7 KB: approximately 99% fewer
transaction payload bytes for the initial page, not 99% less total app traffic.
This is an extrapolation, not a new benchmark. Full-ledger reports still need
historical inputs unless a separately justified design replaces those reads.

For logos, a planning approximation is active browser profiles × unique logo
URLs actually loaded × cold/expired-cache cycles. For example, 100 profiles ×
50 logos × 30 daily cycles is about 150,000 requests/month before failures,
eviction, or URL variants. It is not a usage measurement or a guaranteed bound.

Before implementation, record a baseline for a cold visit, immediate repeat,
return after 30 seconds, and return after six inactive minutes across
Transactions, Positions, Allocation, and one asset detail. Count SQL rows and
bytes separately from HTTP requests and provider calls. Capture logo network
requests with browser cache enabled, including a missing logo and cross-screen
navigation; compare with provider-reported usage. Do not use “Disable cache”
results as representative repeat-user consumption.

Retain financial history, decimal precision, and account isolation. Storage
reduction should start with expired sessions and observed bloat, not deleting
transactions/reviews or persisting derived data elsewhere. Exact quota runway
remains unknown until the Neon account plan and current usage are supplied.

## Verification after implementation

Create a repeatable benchmark fixture with at least:

- 100 users;
- 100 assets per user;
- 10,000 transactions per heavy user;
- 20 quarterly reviews per asset;
- typical and maximum-size text variants.

For each optimized route, capture:

- `EXPLAIN (ANALYZE, BUFFERS)` output;
- selected rows and approximate result bytes;
- API response bytes;
- execution time;
- relation and database size.

The final target is that ordinary page loads and transaction creation have
bounded transfer independent of unrelated historical transactions, while the
database remains below the 350 MB action threshold with at least 100 MB of
headroom.
