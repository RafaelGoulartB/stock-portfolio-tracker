# Portfolio Tracker

Browser-only portfolio dashboard. Requires Node 24 and pnpm. Docker is used
only for the local development database.

## Development

Development uses the local PostgreSQL container and keeps file watching and
hot reload on ports 3001 and 5173. The ignored `.env.development.local` file
contains the local database connection, while `.env` is reserved for the
always-on local production instance.

```bash
pnpm i
cp .env.example .env.development.local
docker compose up -d
pnpm dev
```

Web: http://127.0.0.1:5173
Health: http://127.0.0.1:3001/health

## Always-on local production

The optimized local instance serves the compiled SPA and API from one Node
process at http://localhost:4173. It reads the published database connection
from `.env` and does not start Docker, watch source files, build, or migrate the
database during service startup.

The installed service sets `SESSION_COOKIE_SECURE=false` because this instance
uses plain HTTP and is bound exclusively to `127.0.0.1`. Regular HTTPS
deployments retain secure cookies by default.

After changing the application or adding migrations, deploy explicitly:

```bash
pnpm build:local
pnpm db:migrate:production-local
systemctl --user restart portfolio-tracker.service
```

Inspect the service and its logs with:

```bash
systemctl --user enable --now portfolio-tracker.service
systemctl --user status portfolio-tracker.service
journalctl --user -u portfolio-tracker.service -f
```

## Income providers

The income screen works without configuration through the free Yahoo Finance
adapter. To enrich US dividends with published payment dates and future
declarations, create a free Alpha Vantage key and set `ALPHA_VANTAGE_API_KEY`
in `.env`. Automatic mode merges Alpha Vantage data with Yahoo as its fallback
and caches Alpha Vantage responses for 24 hours to conserve the free quota.

## Authentication deployment

Login and registration are rate-limited by client address. Keep
`TRUST_PROXY=false` for direct deployments. Set it to `true` only behind a
trusted reverse proxy that overwrites `X-Forwarded-For`; otherwise clients can
spoof that header and bypass address-based limits.

See `AGENTS.md` for stack rules.
