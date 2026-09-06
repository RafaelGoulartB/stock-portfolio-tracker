# Plan: Book holdings + CSV import on Transactions

## Context

Operations only supports one buy/sell trade at a time. Users need to seed an
existing portfolio by entering average cost and quantity for many tickers, and
by pasting/uploading a Brazilian CSV/TXT export.

Decisions: UI on Transactions (1A), infer currency/class with editable preview
(2A), single opening date on the form (3B). Each row becomes a synthetic `buy`
so moving-average positions stay consistent with the trade log.

## Affected Files

- `tasks/plan-book-holdings-import.md` — this plan
- `packages/shared/src/transactions.ts` — `bookHoldingsInput` schema
- `packages/shared/src/holdings-import.ts` — CSV/TXT parser + class/currency inference
- `packages/shared/src/index.ts` — re-export
- `apps/api/src/trpc/routers/transactions.ts` — `bookHoldings` mutation
- `apps/api/src/domain/holdings-import.test.ts` — parser tests
- `apps/web/src/routes/_app/transactions.tsx` — mode switch + book UI
- `apps/web/src/components/transactions/book-holdings-panel.tsx` — editable list
- `apps/web/src/components/transactions/import-holdings-dialog.tsx` — paste/file + preview
- `apps/web/src/lib/trpcErrors.ts` — bulk booking error message

## Implementation Checklist

### Phase 1: Shared contracts + parser
- [x] Add `bookHoldingRowSchema` / `bookHoldingsInput` (buys only, fees `0`)
- [x] Parse Brazilian CSV (quoted fields, `R$`, `2.800` thousands, `4,78` decimals)
- [x] Infer currency from money prefix; class from ticker pattern; editable later
- [x] Unit tests covering the sample import

### Phase 2: API
- [x] `transactions.bookHoldings`: validate currency locks per ticker, insert all
      buys atomically (all-or-nothing), shared `tradedAt` + optional note

### Phase 3: UI
- [x] Left card mode: **New trade** | **Book holdings**
- [x] Spreadsheet-like rows (ticker, qty, avg price, class, currency) + add/remove
- [x] Opening date field; register creates one buy per row
- [x] Import dialog: paste and/or `.txt`/`.csv` file → editable preview → merge into list

### Phase 4: Validation
- [x] Paste the sample CSV and confirm six buys appear with correct qty/price
- [x] Manual multi-row entry still works; currency lock still rejects mismatches

## Risks & Technical Debt

- Synthetic buys are indistinguishable from real trades except via notes; acceptable for v0.
- GOOG with `R$` keeps BRL currency and `stock_us` class — preview must stay editable.
- No Tabs primitive yet; use a simple button group to match existing shadcn usage.
