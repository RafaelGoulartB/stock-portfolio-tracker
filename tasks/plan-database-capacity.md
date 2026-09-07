# Database Capacity and Transfer Plan

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

## Current persistence model

The application persists only:

- users and sessions;
- transactions;
- allocation assets;
- quarterly asset reviews;
- categories and asset-category assignments.

Spot quotes, historical price series, dividend events, FX rates, portfolio
positions, and performance snapshots are fetched or calculated on demand and
are not stored. This is favorable for the storage quota.

## PostgreSQL 16 benchmark

The current migrations were applied to a temporary PostgreSQL 16.15 database.
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

The validation needs only:

- the currencies already used by that user's ticker; and
- for a sale, the aggregate available quantity for that ticker.

Prefer SQL aggregates where possible. If domain calculation remains in
TypeScript, load only the ticker ledger, not the user's complete portfolio.

Acceptance criteria:

- creating a transaction does not select unrelated tickers;
- query result size depends on one ticker rather than the complete portfolio;
- mixed-currency protection and overselling protection remain covered by tests;
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
