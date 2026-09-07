# Portfolio Tracker

Portfolio Tracker is a browser-only dashboard for recording investments,
understanding portfolio performance, and planning contributions. It combines a
React SPA with a small Hono/tRPC API and keeps financial calculations explicit,
auditable, and independent from presentation formatting.

## Product principles

### Financial correctness comes first

This application helps users reason about real money. Preserve decimal
precision, transaction history, account isolation, and the documented position
and currency invariants. A plausible-looking number is not sufficient: the
calculation must have one authoritative definition and focused tests for its
edge cases.

### Keep the model small

Prefer the smallest design that makes the correct behavior unsurprising. Put
financial rules in domain modules, validation and transport contracts in the
shared package, and rendering concerns in the web app. Do not add state
managers, abstraction layers, caches, or persistence merely in anticipation of
future scale.

### The dashboard should stay fast and calm

Users repeatedly scan tables, charts, and totals. Avoid unnecessary full-ledger
reads, unbounded responses, render churn, and continuously repainting effects.
Measure before introducing projections or caches. Loading, empty, error, and
stale-data states must tell the truth.

### Browser-first means browser-only

The supported product is the responsive web app. Do not introduce Electron,
native clients, server rendering, or client URLs tied to one machine. Features
should work through the Vite development proxy and through a same-origin
production deployment.

## Shared vocabulary

- **transaction** — a recorded buy or sell used to derive holdings and realized
  results;
- **position** — a per-ticker projection derived from transactions using moving
  average cost;
- **native currency** — the single currency assigned to a ticker's transaction
  history;
- **display currency** — the user-selected `BRL` or `USD` currency used to
  consolidate the portfolio;
- **allocation asset** — a held or watch-only ticker with allocation metadata;
- **review** — a ticker's quarterly grade, notes, and optional fair value;
- **contribution score** — the domain recommendation used to rank new capital;
- **provider** — a replaceable source of market quotes, income events, or FX;
- **account data** — every portfolio record owned by one authenticated user.

Use these terms consistently in code, UI copy, tests, and documentation.

## Stack and layout

Node 24, pnpm workspaces, strict TypeScript, and ESM throughout.

- `apps/web` — React 19/Vite SPA, TanStack Router/Query/Table, Tailwind 4,
  shadcn New York, Lingui, and Recharts;
- `apps/api` — Hono on port 3001, tRPC at `/trpc`, Drizzle, PostgreSQL 16,
  provider adapters, and domain calculations;
- `packages/shared` — Zod schemas, transport types, constants, and small pure
  helpers shared across API and web;
- `apps/api/drizzle` — generated, ordered SQL migrations and Drizzle metadata;
- `tasks` — durable plans and operational analysis for work that genuinely
  needs a dedicated design record.

The web app runs on port 5173. Vite proxies `/trpc` and `/api` to
`http://127.0.0.1:3001`. The API and PostgreSQL use
`America/Sao_Paulo` as their operational timezone.

## Non-negotiable domain rules

- Store money, prices, quantities, rates, percentages, and grades as PostgreSQL
  `numeric(22, 8)`, never floating-point columns. Decimals cross API boundaries
  as strings. Convert to JavaScript `number` only at presentation or provider
  boundaries where the loss is understood and cannot affect stored results.
- Positions use moving average cost, never FIFO. A sell cannot exceed the
  available quantity at that point in the ledger.
- One ticker has one native currency per user. Never average transactions for
  the same ticker across currencies.
- Consolidation happens only into the selected `BRL` or `USD` display currency,
  using an explicit USD/BRL rate. Keep native values available where the
  contract requires them.
- Contribution scoring lives in `apps/api/src/domain/score.ts`. Defaults and
  thresholds live in `DEFAULT_SCORE_CONFIG` in
  `packages/shared/src/score.ts`; never duplicate a scoring threshold in a
  router or component.
- Account-owned queries and mutations must be scoped by `ctx.user.id`. Private
  tRPC endpoints use `protectedProcedure`.
- Authentication uses the `portifolio_session` cookie, stores only its SHA-256
  hash, hashes passwords with scrypt, and keeps the 30-day session TTL.
- Backup export/import is account-scoped. Never export password hashes,
  sessions, or source user IDs. Import is atomic replacement, not an implicit
  merge; preserve the checksum and versioned `.jsonl.gz` contract described in
  `tasks/plan-data-backup.md`.

## Boundaries and providers

- Shared request/response shapes belong in `packages/shared`; parse external
  input at the boundary and keep routers thin.
- Business calculations belong in `apps/api/src/domain`. Do not reimplement
  them in tRPC routers or React components.
- Market quotes, dividends, and FX are unreliable external inputs. Keep their
  adapters behind the provider interfaces under `apps/api/src/lib` and retain
  explicit fallback behavior.
- FX uses the pluggable `FxProvider`; Frankfurter is the default and the manual
  rate is the fallback.
- Income uses Yahoo without configuration. Automatic enrichment may use Alpha
  Vantage when `ALPHA_VANTAGE_API_KEY` is present, with Yahoo as fallback.
- Quote failures must remain distinguishable from a real zero price. Do not
  silently turn missing, stale, or malformed provider data into valid values.
- Do not persist derived positions, quotes, price history, dividends, or FX
  merely for convenience. Add storage only after a measured need and a plan for
  freshness, invalidation, ownership, and migration.

## Web conventions

- Use shadcn New York components directly; do not create a local wrapper layer.
  Use Lucide icons and existing CSS variables, including `--gain` and `--loss`.
  Do not introduce ad-hoc hex colors for semantic states.
- Keep the tRPC client URL relative (`/trpc`). Never bake `localhost`, a Vite
  URL, or a deployment origin into the client bundle.
- TanStack Router owns routing and generates `apps/web/src/routeTree.gen.ts`.
  Do not edit that file manually.
- Server data belongs in TanStack Query. Keep truly local UI state local; do not
  add Zustand or another global store in v0.
- Source code, comments, identifiers, docs, and commits are English. The product
  UI supports English and Brazilian Portuguese through Lingui: English is the
  source message, and user-visible changes must update both `en` and `pt-BR`
  catalogs. Use `pt-BR`, never bare `pt`.
- Locale changes formatting, not stored meaning. Currency remains the asset's
  ISO currency and dates remain explicit domain values.
- Check responsive behavior and keyboard/accessibility semantics for UI work.
  Actions that open, create, or enable state also need an obvious way to close,
  undo, delete, or disable it when the domain permits.

## Database and destructive operations

The local Docker service uses PostgreSQL 16 with database, user, and password
`portifolio`. Treat any configured `DATABASE_URL` as potentially valuable.

- Inspect the target database before resets, bulk deletes, restores, or schema
  experiments. Never assume `.env` points to the disposable Docker database.
- Do not drop schemas, volumes, or user data unless the developer explicitly
  asks. Prefer the application's account-scoped backup before destructive data
  work.
- Change `apps/api/src/db/schema.ts`, generate a migration with
  `pnpm db:generate`, and review the resulting SQL and metadata. Never rewrite
  an already-applied migration to disguise a new schema change.
- New user-owned tables must participate in account isolation, cascade/delete
  behavior, backup manifest counts, export/import ordering, and delete-all.
- Stop only processes you started and whose PID you captured. Do not kill by
  broad name or path pattern; several development services may share the
  machine.

## Development workflow

From the repository root:

```bash
pnpm install
docker compose up -d
pnpm db:migrate
pnpm dev
```

`pnpm dev` migrates the configured database, then starts API and web together.
Read the actual process output if ports are overridden with `API_PORT` or
`WEB_PORT`. The API health endpoint is `/health`.

For representative manual data, use the development-only seed control in the
Data settings area. It is account-scoped and refuses to run in production. Do
not point tests or a development server at a production database.

## Verifying changes

Use the smallest proof that exercises the behavior, then widen checks in
proportion to the risk.

- API behavior: add or update a nearby Vitest test and run
  `pnpm --filter @portifolio-tracker/api test <test-file>`.
- API types: `pnpm --filter @portifolio-tracker/api typecheck`.
- Web types: `pnpm --filter @portifolio-tracker/web typecheck`.
- Shared-contract changes: typecheck shared and every consuming workspace.
- Formatting/lint for touched code files: `pnpm exec biome check <files>`; use
  `--write` only when the resulting edits have been reviewed. Biome does not
  process Markdown in this repository.
- Localized UI: run `pnpm --filter @portifolio-tracker/web i18n:extract` and
  `pnpm --filter @portifolio-tracker/web i18n:compile`, then verify both
  locales have meaningful messages.
- User-visible web changes: build the web app and, when browser use is requested
  or approved, exercise the affected flow with realistic seeded data in both a
  narrow and wide viewport.

Tests should assert observable behavior and financial invariants, not merely
mirror implementation details. Provider tests must be deterministic and must
not depend on a live third-party service. Never use sleeps to make async tests
pass.

Before calling a cross-cutting change complete, check every applicable layer:

- shared schema and inferred types;
- domain calculation and edge cases;
- authenticated API route and account isolation;
- query invalidation and all screens that show the affected value;
- BRL and USD, including missing-rate behavior;
- English and `pt-BR` copy and formatting;
- provider success, fallback, partial-data, and failure states;
- export, import, and delete-all when persisted account data changed;
- existing docs or plans whose assumptions are now stale.

## Documentation and plans

Code and tests should explain local behavior. Add a code comment for a subtle
invariant that must travel with an implementation. Use `tasks/` for decisions
that span layers, destructive data formats, capacity constraints, or work that
needs explicit acceptance criteria; update an existing relevant plan instead
of appending a competing account of the same decision.

Do not create progress diaries, file catalogs, or documentation that only
repeats types and code. When a documented decision changes, rewrite or remove
the stale guidance. Keep setup and user-facing configuration in `README.md`.

## Scope and contribution hygiene

- Preserve unrelated working-tree changes. Do not modify untracked or dirty
  files unless they are part of the requested work.
- Do not create commits, branches, or pull requests unless explicitly asked and always commit without co-author.
- Keep one concern per change and avoid opportunistic refactors.
- No Electron, FIFO, Better Auth, Zustand, Effect, Next.js, or Prisma in v0.
- Brokerage-note parsing remains out of scope until it has a dedicated plan.
- If a rule here conflicts with the requested work, surface the conflict and
  obtain an explicit decision before breaking the invariant.
