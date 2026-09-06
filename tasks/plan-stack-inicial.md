# Plan: Initial stack — Portfolio Tracker

Decision record. **Do not execute this file to scaffold.** Implementation is `tasks/plan-scaffold-stack.md`.

**Language lock:** the entire project is **English** — code, comments, UI copy, README, AGENTS.md, and task docs. `date-fns` `pt-BR` is allowed later for Brazilian market date formatting only, not for source or UI strings.

## 1. Context

Browser-only web dashboard for portfolio management: import brokerage notes, persist holdings, and chart them. No Electron. Monorepo with a separate frontend and server.

This document locks the stack and folder shape. Domain (note parser, FIFO, quotes, auth) is a later plan.

## 2. Locked stack

### Repo and language

| Choice | Why |
|---|---|
| **English only** | One language in the repo. Agents and humans do not mix PT/EN in files. |
| **pnpm workspaces** | Two apps, one lockfile, predictable hoisting. Nx/Turbo/Vite+ is overhead at this size. |
| **TypeScript strict** | The web ↔ api contract must not drift. `strict` is the default, not an extra. |
| **Node 24 LTS** | One runtime for API, Drizzle, and scripts. No Bun on day 1. Root `engines.node`: `>=24`. |
| **ESM (`"type": "module"`)** | Current default; avoids dual CJS/ESM in the monorepo. |

### `apps/web` — dashboard

| Choice | Why |
|---|---|
| **React 19** | Dashboard ecosystem (tables, forms, charts) is React. Compiler can wait. |
| **Vite** | An authenticated SPA does not gain from RSC. Vite is the right bundler with a separate API. |
| **TanStack Router** | Type-safe routes without Next.js. Fits Vite. |
| **TanStack Query** | Server state (positions, notes, charts) lives in the HTTP cache, not a global store. |
| **Tailwind CSS 4** | Utilities, tokens, dark mode. One stylesheet, no CSS-in-JS. |
| **shadcn/ui (New York)** | Components in *our* repo (Button, Table, Dialog, Form, Chart). Standardization without a third-party kit. |
| **react-hook-form + Zod** | Entry/import forms. Same Zod as the API. |
| **TanStack Table** | Holdings, transactions, notes. Official shadcn data-table path. |
| **Recharts via shadcn/charts** | Allocation, equity over time, P&L. No trading terminal in v0. |
| **lucide-react** | One icon set. Do not mix. |
| **date-fns** | Note dates and chart axes. Light. API timezone: `America/Sao_Paulo`. UI strings stay English; `pt-BR` locale only when formatting Brazilian market dates. |

**Not in web now:** Zustand, Redux, Next.js, MUI, raw Base UI, Lightweight Charts.

Client state (open modal, active tab) is `useState` / URL search params. A global store only when a third component needs the same thing.

### `apps/api` — server

| Choice | Why |
|---|---|
| **Hono** | Minimal typed HTTP, multipart (note upload), long-running Node — parse and quote jobs do not fit serverless. |
| **tRPC** | Typed procedures web ↔ api without OpenAPI on day 1. Fits TanStack Query. |
| **Zod** | Validation at the procedure edge. Shared schemas via `packages/shared`. |
| **postgres.js (`postgres`)** | Driver Drizzle recommends for Postgres. Simple and fast. |

**Not in the API now:** Effect, Nest, Prisma, event sourcing, GraphQL, REST alongside tRPC.

### Data

| Choice | Why |
|---|---|
| **Postgres 16** | Relational (asset → note → transaction → lot). `numeric` for money. `jsonb` for raw note parse. Same database in dev and prod. |
| **Drizzle ORM** | Schema in TypeScript, explicit SQL, inferred types. No magic layer on P&L. |
| **drizzle-kit** | Versioned migrations. Schema in code is the source of truth. |
| **`numeric`, never `float`** | Money rounding is not negotiable. |

Dev: Postgres via Docker Compose. One `DATABASE_URL`. No SQLite “for now”.

### Quality and ops (minimum)

| Choice | Why |
|---|---|
| **Biome** | Lint + format in one tool. No ESLint+Prettier pair. |
| **Vitest** | API tests (schema, lot rules) and utils. No UI suite in v0. |
| **Docker Compose** | Postgres only. API and Vite run on the host. |
| **Local gitignored `.env`** | `DATABASE_URL` and nothing else in v0. |

**Auth:** out of v0 (single user). When it lands, Better Auth — self-host, fits Hono/Postgres. Not Clerk now.

**Uploads:** local disk `apps/api/data/uploads` gitignored. S3 only when there is a real second environment.

## 3. Folder structure

Target tree (scaffold executes this in `tasks/plan-scaffold-stack.md`). Do not create `money/` or domain routers in the first scaffold.

```text
portifolio-tracker/
├── apps/
│   ├── web/                      # dashboard (Vite + React)
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   └── ui/           # shadcn-generated (do not wrap)
│   │   │   ├── routes/           # TanStack Router
│   │   │   ├── lib/
│   │   │   │   ├── api.ts        # tRPC client
│   │   │   │   └── utils.ts      # cn() etc.
│   │   │   ├── styles/
│   │   │   │   └── globals.css   # Tailwind + shadcn tokens + gain/loss
│   │   │   ├── main.tsx
│   │   │   └── routeTree.gen.ts
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   ├── components.json       # shadcn
│   │   └── package.json
│   └── api/                      # Hono + tRPC + Drizzle
│       ├── src/
│       │   ├── trpc/
│       │   │   ├── context.ts
│       │   │   └── router.ts     # root (`health` only at scaffold)
│       │   ├── db/
│       │   │   ├── index.ts      # Drizzle client
│       │   │   └── schema.ts     # empty at scaffold
│       │   ├── index.ts          # Hono bootstrap
│       │   └── env.ts
│       ├── drizzle/              # SQL from drizzle-kit
│       ├── data/                 # gitignored (uploads, local)
│       ├── drizzle.config.ts
│       └── package.json
├── packages/
│   └── shared/                   # Zod + types used by both apps
│       ├── src/
│       │   └── index.ts
│       └── package.json
├── AGENTS.md                     # English source of truth for agents
├── CLAUDE.md                     # symlink → AGENTS.md (do not copy)
├── docker-compose.yml            # postgres:16
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── biome.json
├── .env.example
├── .gitignore
└── tasks/
```

### Do not create on day 1

- `packages/ui` — shadcn stays in `apps/web` until a second client exists.
- `packages/db` — schema lives in `apps/api` until a separate worker needs it.
- `apps/marketing`, `apps/desktop` — out of scope.
- Auth, queues, object storage.

`packages/shared` starts small: Zod schemas when web and api need the same type. Not a utils barrel.

## 4. AGENTS.md and CLAUDE.md

Created as part of the scaffold (`tasks/plan-scaffold-stack.md`), not as a docs-only pass.

### `AGENTS.md` (real file)

Repo root. Short, prescriptive, **English**. No tutorial.

1. **What** — portfolio dashboard, 100% browser, no Electron.
2. **Locked stack** — copy the tables in this plan.
3. **Where code lives** — `apps/web`, `apps/api`, `packages/shared`. shadcn in `apps/web/src/components/ui`. Drizzle schema in `apps/api` until a second consumer exists.
4. **Rules** — `numeric` never `float`; do not wrap shadcn; New York only; `gain`/`loss` tokens; Vite `/trpc` proxy with no baked localhost; YAGNI (no Zustand, Effect, Next, Prisma, auth in v0); **English only**.
5. **Out of scope until a dedicated plan** — brokerage-note parser, FIFO, quotes, Better Auth.
6. **Docs** — `tasks/` holds plans. Do not commit agent scratch notes elsewhere.

Do not duplicate tutorials. Link this file as the stack decision and `tasks/plan-scaffold-stack.md` as the scaffold runbook.

### `CLAUDE.md` (link only)

Claude Code reads `CLAUDE.md`. Cursor and others read `AGENTS.md`. **One body, two names.**

- `CLAUDE.md` is **not** a second file with text.
- `CLAUDE.md` is a **symlink** to `AGENTS.md`.
- Content changes only in `AGENTS.md`.

Windows (PowerShell, repo root):

```powershell
New-Item -ItemType SymbolicLink -Path CLAUDE.md -Target AGENTS.md
```

Unix:

```bash
ln -s AGENTS.md CLAUDE.md
```

If the symlink fails, do not paste the contents into `CLAUDE.md`. Fix the link (Windows Developer Mode).

## 5. Scaffold

Execute `tasks/plan-scaffold-stack.md`. Do not follow the old “docs only” checklist in earlier revisions of this file.

## 6. Rejected on purpose

| No | Why |
|---|---|
| Next.js | Mixes frontend and server; PDF parse and cron need a long-lived process. A landing page, if any, is another app later. |
| Effect / Effect RPC | Steep cost. tRPC covers the contract. |
| Event sourcing | CRUD + import + time series. An event log only if we need real audit. |
| Electron | Requirement: 100% browser. |
| SQLite / Mongo | SQLite hurts with API+job; Mongo is the wrong shape for lots/FIFO. |
| Prisma | More magic, worse fit for analytical SQL. |
| MUI / Chakra / Ant | Another design system. Fights Tailwind. |
| Zustand / Redux in v0 | Query covers the server; local UI does not need a store. |
| Auth in v0 | One user. Defer. |
| Lightweight Charts | Trading terminal, not portfolio. Recharts covers allocation and P&L. |

## 7. Still open (domain, not stack)

- Brokerage-note parser (PDF vs XML, brokers).
- Cost method (FIFO vs average).
- Quote provider.
- Multi-user / Better Auth.
- Prod host (VPS vs PaaS). The API needs a long-lived process; the web is static + proxy.

## 8. Risks

- **Two dev processes** (Vite + Hono) — root `pnpm dev` must start both.
- **CORS / API URL** — Vite proxies `/trpc`. Do not bake localhost into the bundle.
- **Money in JS** — `numeric` in Postgres; string or a decimal library at the edge. Never `number` for BRL.
- **Undisciplined shadcn** — installing the full catalog or wrapping `Button` kills consistency. CLI piece by piece; tokens in CSS.
- **Schema too early** — scaffold does not model the portfolio. Domain tables are a later plan.
- **Mixed language** — Portuguese in source or UI is a defect.

## 9. Next step

Hand `tasks/plan-scaffold-stack.md` to the implementing agent. This file stays the stack decision record.
