# Portfolio Tracker

Browser-only portfolio dashboard. Requires Node 24, pnpm, and Docker.

```bash
pnpm i
docker compose up -d
pnpm db:migrate
pnpm dev
```

Web: http://127.0.0.1:5173
Health: http://127.0.0.1:3001/health

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
