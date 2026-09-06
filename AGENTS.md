# Agent notes

Browser-only portfolio dashboard (no Electron). English only in this repo.

## Stack

Node 24, pnpm workspaces, TypeScript `strict`, ESM. Vite, React 19, TanStack Router / Query / Table, Tailwind 4, shadcn New York (neutral, CSS variables, lucide). Hono on port 3001, tRPC at `/trpc`, Zod, Postgres 16 (`postgres:16`, db/user `portifolio`), Drizzle, Biome, Vitest. Web on 5173; Vite proxies `/trpc` to `http://127.0.0.1:3001`. API timezone `America/Sao_Paulo`.

## Layout

- `apps/web` — dashboard SPA
- `apps/api` — Hono + tRPC + Drizzle
- `packages/shared` — shared Zod schemas
- `tasks/` — plans. Stack decision: `tasks/plan-stack-inicial.md`. Scaffold: `tasks/plan-scaffold-stack.md`

## Rules

- Money: Postgres `numeric`, never `float`
- Do not wrap shadcn; New York only; use `--gain` / `--loss` tokens (no ad-hoc hex)
- tRPC client URL is `/trpc` (Vite proxy). Do not bake `localhost` into the client
- No Zustand, Effect, Next, Prisma, or auth in v0
- English only: code, comments, UI, docs, commits

## Out of scope until a dedicated plan

Brokerage-note parser, FIFO, quotes, Better Auth.
