# B3 integration

Status: **proposed** (study of 2026-10-04). Nothing here is implemented. The
open decisions at the end need the developer's answer before Phase 1.

## Goal

Keep each account's Brazilian ledger (trades, cash income, corporate events,
year-end holdings) consistent with what B3 records for the investor, so the
income-tax report can be trusted. B3 is the central depository: what it
shows per CPF is the reference the Receita Federal also receives.

## Sources studied

| Source | Access | Content | Fit |
| --- | --- | --- | --- |
| **B3 Área do Investidor API** (Posição, Movimentação, Negociação de Ativos, Eventos Provisionados, Ofertas Públicas, API Guia) | Legal entities only, after a contract and B3's security self-assessment. B3 states it offers no direct access for individuals. Billed per investor authorization. The investor grants and revokes consent in the Área do Investidor. | Structured, D-1 (from 08:00), history since 2019-11-01, one call per investor per day recommended, API Guia lists who changed | Best data, but blocked for a personal app without a CNPJ and a B3 contract |
| **Área do Investidor exports** downloaded by the user (Excel or PDF) | Free, by the investor | Movimentação, Negociação, Posição on any date (e.g. last business day of the year), annual Relatório Consolidado | Feasible now. Lower precision (see below). Manual refresh. |
| **B3 public listed-company data** (`sistemaswebb3-listados…/listedCompaniesProxy`), the endpoints behind b3.com.br | Public, undocumented, no SLA | Per issuer: `cashDividends` (ISIN, `label` DIVIDENDO / JRS CAP PROPRIO / RENDIMENTO, `rate` with 11 decimals, `approvedOn`, `lastDatePrior` = data com, `paymentDate`), `stockDividends` (DESDOBRAMENTO / GRUPAMENTO / BONIFICACAO / RESG TOTAL RV with `factor`), `subscriptions` (`percentage`, `priceUnit`, periods), and `GetInitialCompanies` (CNPJ, CVM code) | Good for cross-checks, announced income and CNPJ. Not a tax record. Cash history is short: the 2026-10 probe returned only events since 2025. |
| CVM open data (already used by `lib/results/cvm-b3.ts`) | Public | Notices to shareholders (IPE) | The source of a bonus's attributed cost when B3 does not show it precisely |
| Open Finance aggregators (e.g. Pluggy, which has a B3 partnership) | Paid, third party holds the consent | Varies | Not evaluated in depth. It adds a third party to sensitive data. |
| Scraping the Área do Investidor with the user's gov.br credentials | — | — | **Rejected**: stores government credentials, breaks the terms, fragile under 2FA |

## What the exports contain (verified on real 2019–2021 Movimentação files)

Movimentação columns: `Entrada/Saída` (`Credito`/`Debito`), `Data`
(`DD/MM/YYYY`), `Movimentação`, `Produto` (`TICKER - ISSUER NAME`, with
variable padding), `Instituição`, `Quantidade` (text with a decimal comma),
`Preço unitário`, `Valor da Operação` (`-` when absent).

The movement types seen in the samples are listed below, with what each one
means for this app.

| Movimentação | Meaning |
| --- | --- |
| `Transferência - Liquidação` | Trade settlement, dated on the **settlement** day. It is not the trade date and carries no fees. Use it only as a cross-check. |
| `Compra` / `COMPRA / VENDA` | Tesouro Direto and fixed-income trades (out of scope) |
| `Dividendo` | Cash dividend. The value is the paid amount in cents. |
| `Juros Sobre Capital Próprio` | JCP. `Preço unitário` is the **gross** rate rounded to 2 places; `Valor da Operação` is **net of IRRF**. Checked: 28 × 0.2466 × 0.85 = 5.87. |
| `Rendimento` | FII income (also some units) |
| `Bonificação em Ativos` | Bonus shares. The quantity can be fractional (`16,05`). `Preço unitário` carries the attributed cost rounded to cents (18.89). |
| `Fração em Ativos` | Fractions removed before an auction. Quantity prints as `0`, i.e. **rounded away**. |
| `Leilão de Fração` | Cash from the fraction auction. Quantity `0`; the value and the auction price are present. |
| `Atualização`, `Incorporação` | A merger or ticker change (JPSA11 → IGTI11). Only partial quantities appear; the exchange ratio does not. |
| `Direito de Subscrição`, `Direitos de Subscrição - Não Exercido` | Subscription rights received or lapsed (`-` prices) |
| `Cobrança de Taxa Semestral` | Tesouro custody fee (out of scope) |

The same ticker can appear on the same day with the same type several times
legitimately: one row per event and institution (ITSA4 JCP on 2021-08-26
appears five times). Rows therefore have **no natural unique key**.

Other open-source parsers report two more behaviors. On a split
(`Desdobro`) the quantity is the new shares. On a reverse split
(`Grupamento`) the quantity is the resulting position. Lending
(`Empréstimo`), reimbursements, amortization, `Restituição de Capital`,
`Cisão`, custody `Transferência` and subscription receipts also occur. The
columns of Negociação and Posição are reported by third parties (Negociação:
`Data do Negócio`, `Tipo de Movimentação`, `Mercado`, `Prazo/Vencimento`,
`Instituição`, `Código de Negociação`, `Quantidade`, `Preço`, `Valor`).
**Phase 0 must confirm them on real files.**

### Precision limits of the exports

- Unit prices are rounded to 2 decimals. `Valor da Operação` (cents) is the
  cash fact; a price is derived as value ÷ quantity, never the reverse. This
  is the same "cash is authoritative" rule as broker notes.
- Quantities can be rounded (`0` for fractions). A fraction must be derived
  from the ledger: the fractional part held after the bonus.
- No fees, brokerage, emoluments or IRRF on trades. B3 data alone cannot
  give the tax cost basis; broker notes stay the authority for trade costs.
- Numbers come as Excel doubles or text with a decimal comma. The parser
  must read the raw cell text (the XML `v` string) into a decimal, never
  through a JavaScript `number`.

## Decision (proposed)

1. **The user's own exports are the B3 source now.** The app accepts
   Movimentação, Negociação and Posição `.xlsx` files on a new
   Transactions → **B3** tab. The parsed rows are stored as account data
   (not the file itself; keep its SHA-256 like broker notes).
2. **Reconciliation comes before booking.** The first deliverable writes
   nothing to the ledger. It compares B3 with the app and lists every
   difference. Booking from B3 is added afterwards, one record kind at a
   time, each owned by its import, so deleting the import undoes it (the
   broker-note ownership rule).
3. **Broker notes remain the authority for trades.** A Negociação trade
   missing from the ledger is reported. Booking it is allowed only as a
   trade with `fees unknown`, and that state keeps the affected tax year from
   being marked verified.
4. **The public B3 data is a provider, not a record.** It sits behind an
   interface like the quote and dividend providers, with in-memory caching
   and explicit failure. It serves cross-checks, announced (not yet paid)
   income and CNPJs. It is never booked silently.
5. **The source model is API-ready.** Each parser produces normalized
   records `{source, institution, date, kind, ticker, isin?, quantity,
   amounts…}`. An official-API adapter could later feed the same records if
   a licensed legal entity exists (open decision 1).

## Proposed model

- `b3_imports` (user-owned, cascade): `kind` (`movement` | `trading` |
  `position`), file SHA-256 and name, covered period (`from`/`to`; the
  position date for `position`), row count, imported at.
- `b3_statement_rows` (user-owned, cascade to the import): normalized row
  (kind, date, direction, ticker, raw product text, institution, quantity,
  unit price, value — all decimal text → `numeric(22, 8)`), row ordinal, and
  a content hash. **Duplicates across overlapping imports are matched as a
  multiset** per content hash within the overlapping window, because
  identical rows can be legitimate. A row present in an older import but
  missing from a newer one covering the same window is reported as
  "changed at B3", never deleted silently.
- `income_receipts` (Phase 2): ticker, payer CNPJ, kind (`dividend` | `jcp` |
  `fii_income` | `other`), payment date, quantity, gross, withheld, net,
  institution, owning `b3_import_id` or manual. Gross JCP is derived as
  net ÷ (1 − rate of the payment year) and must agree within R$ 0.01 per row
  with public `rate × eligible quantity` when that is available. Otherwise it
  is flagged for review.
- New corporate-action kinds (Phase 3–4): `fraction_auction` (a sale owned
  by the import), `conversion` (ticker A → ticker B with ratio and carried
  cost), `capital_return` (cost reduction), and subscription events. Each
  needs its own design note, because a conversion crosses tickers and
  `adjustForSplits` works per ticker today.
- Positions stay per ticker. The institution lives on B3 rows, receipts
  and reconciliation output, not on positions. Custody `Transferência`
  between institutions is neutral, never a trade.
- Every new table joins backup (next version), export/import ordering,
  manifest counts, `data.summary` and delete-all.

## Reconciliation checks

| Check | B3 side | App side | Result |
| --- | --- | --- | --- |
| Holdings at date D | Posição on D (per institution, summed per ticker) | Ledger units at D, split-adjusted to D | Difference per ticker. A year is **B3-verified** only when D = last business day matches for every BRL ticker. |
| Trades | Negociação (trade date, base ticker without `F`, side, quantity, price) | Ledger trades | Missing in app, missing at B3, quantity or price mismatch |
| Settlements | Movimentação `Transferência - Liquidação` | Ledger trades, shifted to settlement | Cross-check only |
| Bonus, split, reverse split | Movimentação quantities; public `factor` × units at data com | `corporate_actions` | Missing or different event; bonus cost vs `unit_cost` |
| Cash income | Movimentação values | Public `rate` × units at data com, and later `income_receipts` | Missing trade before data com, unknown event, wrong gross |
| Fractions | `Fração em Ativos` + `Leilão de Fração` | Fractional units left in the ledger | Missing fraction sale |

Unsupported rows (Tesouro, fixed income, lending, options) are listed as
"not handled", never skipped silently.

## Tax facts the income ledger must respect

These must be year-versioned constants in `packages/shared/src/income-tax.ts`
and re-checked against each year's official IRPF program:

- JCP IRRF is 15% until 2025 and **17.5% from 2026-01-01** (LC 224/2025).
  JCP goes in "tributação exclusiva" (code 10), per paying CNPJ.
- Dividends are exempt (code 09) per paying CNPJ. Since 2026
  (Lei 15.270/2025), dividends above R$ 50,000 a month from one payer
  suffer 10% IRRF, and the annual minimum tax (IRPFM) counts dividends for
  incomes above R$ 600,000. Receipts must keep the withheld amount even
  when it is usually zero.
- FII income is exempt under its conditions. Sources disagree on the code
  (26 vs 99) for recent years; confirm in the official program before
  printing a code.
- Bonus shares: code 18 with the attributed cost (already in the report).
  B3's cost is rounded to cents; the issuer's notice is the exact source.
- A fraction auction is a sale for capital-gain purposes.

## Phases

0. **Spike (no app code).** The developer downloads real files: Movimentação
   from 2019-11 to today, Negociação for the same period, Posição at the
   last business day of 2024 and 2025, and the annual Relatório
   Consolidado. Confirm columns and the movement-type catalog, the JCP
   net/gross rule, split and reverse-split quantities, and the FII public
   endpoint. Build **synthetic** fixtures; personal files never enter the
   repository.
1. **Reconciliation report (read-only).** Upload → parse → compare → report.
   Persist imports and rows. No ledger writes. Expose a "B3-verified" state
   per tax year on the IR page.
2. **Income ledger.** Book dividends, JCP and FII income from Movimentação
   with gross, IRRF and net. Add the IR sections "rendimentos isentos" and
   "tributação exclusiva" per payer CNPJ. The Income page shows received vs
   announced.
3. **Corporate events from B3.** Suggest splits, reverse splits and bonuses
   from Movimentação, cross-checked with the public factor. Book fraction
   auctions as sales and treat custody transfers as neutral.
4. **Ledger completion.** Optional trades from Negociação (flagged without
   fees) and an opening position from a Posição snapshot as an alternative
   to "book holdings".
5. **Complex events.** Conversions and mergers, subscriptions (rights,
   receipts, assignments, lapses), capital returns and amortization. Each
   gets its own design note.
6. **Optional official API.** Only after open decision 1.

## Open decisions

1. Use the official API? It needs a legal entity, B3's approval and a
   per-authorization fee. Recommendation: no for now, and keep the model
   API-ready.
2. Store B3 rows as account data, needed for overlap dedupe and audit?
   Recommendation: yes.
3. May Negociação create trades without fees, or only report them?
   Recommendation: report in Phase 1, flagged booking in Phase 4.
4. Should the IR report refuse a year that is not B3-verified, or only
   warn? Recommendation: warn prominently, never block.

## Acceptance (Phase 1)

- Parser tests on synthetic workbooks: every movement type in the catalog,
  decimal-comma and raw-double cells, `-` values, padded products,
  fractional quantities, duplicate identical rows, and an unknown type
  (reported, not dropped).
- Overlapping imports neither double count nor lose legitimate duplicates.
- The holdings check flags a missing trade, a missing split and a missing
  bonus on synthetic ledgers, and passes on a ledger that matches.
- Account isolation, backup, delete-all and both locales are covered.
