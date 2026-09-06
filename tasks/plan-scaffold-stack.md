# Plan: Scaffold the stack — execute this file

Stack *why* lives in `tasks/plan-stack-inicial.md`. **This file is what the agent runs.** Do not reopen framework choices.

**Language lock:** the entire project is **English**. Code, comments, UI copy, README, AGENTS.md, commits (if any), and task docs. No Portuguese in repo files. `date-fns` `pt-BR` is allowed later for market date formatting — not for source or UI strings in this scaffold.

---

## 1. Context and scope

Stand up the monorepo with the stack **installed and booting**: web, api, Postgres, tRPC, shadcn, Drizzle, AGENTS.md. Domain coding starts after this.

**Do:** tooling, empty apps that boot, stack deps in `package.json`, minimal shell, health, agent docs.

**Do not:** brokerage-note parser, FIFO, quotes, auth, portfolio tables, asset/note pages, `Money`/`PnL` components, `assets` / `notes` / `transactions` routers, a long README, Turborepo, Nx, Next, Effect, Prisma, Electron.

A business screen or table is not required to “prove” the stack. Health + shell are enough.

---

## 2. Locks (do not improvise)

| Item | Value |
|---|---|
| Language | **English** everywhere in the repo |
| Node | **24** — `.node-version` contains `24`. Root `"engines": { "node": ">=24" }` |
| Package manager | **pnpm** — set `"packageManager": "pnpm@<local version>"` (`pnpm -v`). Workspaces: `apps/*`, `packages/*` |
| npm names | `@portifolio-tracker/web`, `@portifolio-tracker/api`, `@portifolio-tracker/shared` |
| Modules | `"type": "module"` in every `package.json` |
| TypeScript | `strict: true` via `tsconfig.base.json`. Apps extend the base |
| Alias | `@/*` → `./src/*` in `apps/web` and `apps/api` |
| API port | **3001** |
| Web port | **5173** |
| Vite proxy | `/trpc` → `http://127.0.0.1:3001` (do not bake a URL into the client) |
| Postgres | image `postgres:16`, host port **5432**, db/user `portifolio`, password `portifolio` (local only) |
| `DATABASE_URL` | `postgres://portifolio:portifolio@127.0.0.1:5432/portifolio` |
| API timezone | `America/Sao_Paulo` (`TZ=America/Sao_Paulo` on the Postgres compose service) |
| shadcn | **New York**, CSS variables, **lucide** icons, base-color **neutral** |
| Git | `git init` at the root if it is not a repo yet. Do not commit unless the human asks |

Workspace deps: `"@portifolio-tracker/shared": "workspace:*"`.

---

## 3. Tree to create (only this)

Do not create `components/money` or `trpc/routers/assets.ts`.

```text
portifolio-tracker/
├── .gitignore
├── .node-version                 # 24
├── .env.example
├── .env                          # gitignored; copy from example
├── AGENTS.md
├── CLAUDE.md                     # symlink → AGENTS.md
├── README.md                     # ≤15 lines, English
├── biome.json
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── apps/
│   ├── api/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   ├── data/.gitkeep         # data/uploads gitignored
│   │   └── src/
│   │       ├── index.ts          # Hono listen 3001
│   │       ├── env.ts            # Zod: DATABASE_URL
│   │       ├── db/index.ts
│   │       ├── db/schema.ts      # empty — no domain tables
│   │       └── trpc/
│   │           ├── context.ts
│   │           ├── trpc.ts       # init tRPC
│   │           └── router.ts     # appRouter: `health` procedure
│   └── web/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── components.json
│       └── src/
│           ├── main.tsx
│           ├── styles/globals.css
│           ├── lib/utils.ts      # cn()
│           ├── lib/api.ts        # tRPC client (relative /trpc)
│           ├── components/ui/    # only what shadcn CLI generates for the shell
│           └── routes/           # TanStack Router: __root + index
├── packages/
│   └── shared/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/index.ts          # empty export or `export {}`
└── tasks/                        # already exists; do not delete
```

---

## 4. Packages to install (full stack, used later)

Versions: **latest stable** of each. Do not add anything outside this list unless boot requires it.

### Root (dev)

- `biome`
- `typescript`
- `@types/node`
- **not** `turbo`
- `concurrently` for `pnpm dev` (api + web)

Root scripts:

```json
{
  "dev": "concurrently -n api,web -c blue,green \"pnpm --filter @portifolio-tracker/api dev\" \"pnpm --filter @portifolio-tracker/web dev\"",
  "lint": "biome check .",
  "format": "biome check --write .",
  "typecheck": "pnpm -r typecheck",
  "db:generate": "pnpm --filter @portifolio-tracker/api db:generate",
  "db:migrate": "pnpm --filter @portifolio-tracker/api db:migrate"
}
```

### `packages/shared`

- `zod`

### `apps/api`

- `hono`
- `@hono/node-server`
- `@hono/trpc-server` (or the official tRPC fetch adapter for Hono on the current tRPC major — **one** adapter, not both)
- `@trpc/server`
- `drizzle-orm`
- `drizzle-kit` (dev)
- `postgres`
- `zod`
- `vitest` (dev) — minimal config; **no domain tests**. Optional `health.test.ts` that only asserts the router exports. If it blocks boot, skip the test; keep vitest installed.

API scripts: `dev` (tsx watch or node `--watch`), `typecheck`, `db:generate`, `db:migrate`, `test`.

### `apps/web`

- `react` / `react-dom` (19)
- `vite` + `@vitejs/plugin-react`
- `@tanstack/react-router` + official Vite plugin
- `@tanstack/react-query`
- `@trpc/client` + `@trpc/react-query` (current major names)
- `tailwindcss` `@tailwindcss/vite` (v4)
- `class-variance-authority` `clsx` `tailwind-merge` `lucide-react` (shadcn)
- `react-hook-form` `@hookform/resolvers` `zod`
- `@tanstack/react-table`
- `recharts`
- `date-fns`

**Do not generate** shadcn Form, DataTable, or Chart components in this step. Libraries stay in `package.json` for the first feature.

shadcn CLI: `init` for Vite + Tailwind 4 + `@/` alias. Generate only what the shell needs: **`button`**. One extra primitive (`card`) is OK if the layout is too bare. Stop there.

---

## 5. Config files — minimum content

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### `docker-compose.yml`

Single `postgres` service:

- `postgres:16`
- `POSTGRES_USER/PASSWORD/DB=portifolio`
- `TZ=America/Sao_Paulo`
- ports `5432:5432`
- named volume `pgdata`

### `.env.example` and `.env`

```
DATABASE_URL=postgres://portifolio:portifolio@127.0.0.1:5432/portifolio
```

Nothing else. `.env` in `.gitignore`.

### `.gitignore`

`node_modules`, `dist`, `.env`, `apps/api/data/uploads`, `.turbo`, `*.local`, logs, coverage, `.DS_Store`.

### `apps/api` HTTP

- `GET /health` → `{ "ok": true }` (plain Hono, useful without tRPC)
- tRPC mounted at `/trpc`
- CORS: `http://127.0.0.1:5173` and `http://localhost:5173`
- tRPC procedure `health` → `{ ok: true }` (web may call it later; the shell does not have to)
- Drizzle: connect; `/health` should run `SELECT 1`. If it fails, health returns 503. That proves Postgres with no domain schema.
- `schema.ts`: no tables. Do not invent `users` / `assets`.
- Migrations: scripts ready. If the kit refuses an empty schema, leave `drizzle/` with a one-line English README and **do not** create a dummy business table. Prefer `SELECT 1` via the `postgres` client.

### `apps/web`

- TanStack Router: root layout + index
- Index: obvious shell (“Portfolio Tracker”, one shadcn `Button`). No fake dashboard, no placeholder charts
- Provider: QueryClient + tRPC
- tRPC client: `url: "/trpc"` (proxy). **Forbidden:** `VITE_API_URL=http://localhost:...` in the bundle
- Dark mode: shadcn tokens in `globals.css`. Add CSS tokens `--gain` and `--loss` (green/red) even without a Money component — so the first screen does not invent hex values
- All visible strings: English

### README.md (max 15 lines)

English. Require Node 24 + pnpm + Docker; `pnpm i`; `docker compose up -d`; `pnpm dev`; web `http://127.0.0.1:5173`; health `http://127.0.0.1:3001/health`.

---

## 6. AGENTS.md and CLAUDE.md

### `AGENTS.md`

Real file at the repo root. Short, prescriptive, **English**. No tutorial.

Include:

1. What it is: portfolio dashboard, 100% browser, no Electron
2. Stack (section 2 of this plan + Vite, React 19, TanStack Router/Query/Table, Tailwind 4, shadcn New York, Hono, tRPC, Zod, Postgres 16, Drizzle, Biome, Vitest)
3. Layout: `apps/web`, `apps/api`, `packages/shared`
4. Rules: `numeric` never `float`; do not wrap shadcn; New York only; `gain`/`loss` tokens; `/trpc` proxy; no Zustand/Effect/Next/Prisma/auth in v0; **English only in the repo**
5. Out of scope until a dedicated plan: brokerage-note parser, FIFO, quotes, Better Auth
6. Plans live in `tasks/`. Stack decision: `tasks/plan-stack-inicial.md`. This scaffold: `tasks/plan-scaffold-stack.md`

### `CLAUDE.md`

**Symlink only** to `AGENTS.md`. Do not copy text.

Windows (PowerShell, repo root):

```powershell
New-Item -ItemType SymbolicLink -Path CLAUDE.md -Target AGENTS.md
```

Unix:

```bash
ln -s AGENTS.md CLAUDE.md
```

If Windows refuses: turn on Developer Mode (Settings → For developers) and retry. **Do not** paste AGENTS.md contents into `CLAUDE.md`.

Check: reading `CLAUDE.md` yields the same text as `AGENTS.md`. In Git it must be a symlink, not a markdown blob.

---

## 7. Implementation checklist

### Phase 1 — Repo

- [ ] `git init` if there is no `.git`
- [ ] `.node-version`, `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`, `biome.json`, `.gitignore`, `.env.example`, `.env`
- [ ] `docker-compose.yml`
- [ ] `packages/shared` exportable (`zod` installed)
- [ ] `pnpm i` at the root produces the lockfile

### Phase 2 — API

- [ ] Hono on 3001, `GET /health`
- [ ] tRPC `appRouter` with `health`
- [ ] CORS for Vite
- [ ] Drizzle + `postgres` + `env.ts`; `/health` runs `SELECT 1`
- [ ] `data/uploads` gitignored
- [ ] Vitest installed

### Phase 3 — Web

- [ ] Vite + React 19 + TanStack Router + Tailwind 4
- [ ] shadcn New York + `button` + `gain`/`loss` tokens
- [ ] `/trpc` proxy + tRPC client
- [ ] Stack deps installed (RHF, table, recharts, date-fns) **with no screens that use them**
- [ ] English shell on `/`

### Phase 4 — Agents and docs

- [ ] `AGENTS.md` in English
- [ ] `CLAUDE.md` → symlink
- [ ] Short English `README.md`

### Phase 5 — Validation (required)

- [ ] `docker compose up -d` — Postgres healthy
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes (or equivalent `biome check`)
- [ ] `pnpm dev` starts **both**
- [ ] `GET http://127.0.0.1:3001/health` → 200 `{ ok: true }` (and DB live if health runs `SELECT 1`)
- [ ] Open `http://127.0.0.1:5173` — English shell with Button, no proxy/tRPC console errors on boot
- [ ] Confirm Postgres has **no** `assets` / `transactions` / `notes` tables
- [ ] Confirm `CLAUDE.md` is a symlink
- [ ] Confirm no Portuguese in created source/docs/UI

Browser MCP is optional if `curl` health + Vite HTML 200 is enough; verify the shell in a browser when tools exist.

---

## 8. Risks (read before coding)

- **Scope creep** — “while I am here, I will add an assets table”. No.
- **localhost in the bundle** — Vite proxy only.
- **Two health endpoints** — keep both: HTTP `/health` for ops; tRPC procedure for the client.
- **Dummy schema** — forbidden as an excuse to migrate.
- **shadcn catalog** — `button` only (`card` if the shell is too bare).
- **Windows symlink** — common failure; no copy-paste fallback.
- **pnpm in the wrong folder** — always install from the workspace root.
- **Portuguese files** — reject and rewrite in English.
- **Do not delete** `tasks/plan-stack-inicial.md`.

---

## 9. Definition of Done

Done when:

1. `pnpm i` + `docker compose up -d` + `pnpm dev` work on this machine
2. Health 200 and UI shell in the browser (English)
3. `typecheck` and `lint` clean
4. `package.json` stack matches section 4 (libs present, features not implemented)
5. `AGENTS.md` (English) + `CLAUDE.md` symlink
6. Zero portfolio domain code
7. No Portuguese in repo files this agent created

Stop. Do not open a PR, do not commit, do not start the next feature.
