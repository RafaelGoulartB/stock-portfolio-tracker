# Income tax (IRPF) assistant

## Decision

The app computes the Brazilian income tax on **buys and sells** from the
account's transactions — broker-note imports and manual trades alike — and
prints a yearly report that mirrors the IRPF forms. Dividends, JCP and other
income stay out: they come from external providers and are not tax records.

Nothing derived is stored. The monthly assessment, the loss carryforward, the
withheld tax and the year-end holdings are recomputed from the ledger on every
request, so a new note, an edited trade or a deleted note updates every later
month automatically. Persisted inputs are only facts the ledger cannot know:

- **opening balances** (`income_tax_settings`, one row per account): the
  first assessed year and the balances carried into it — losses to offset
  per category and a pending DARF below the R$ 10 minimum. Sales before the
  first assessed year still shape the average cost, but their results are
  not assessed again (that year was already declared);
- **DARF payments** (`darf_payments`, one per month): date and amount paid,
  shown next to the DARF due. They never change the assessment;
- **tax details per ticker** (`asset_tax_profiles`): issuer legal name, CNPJ
  (numeric or alphanumeric, check digits verified) and a broker overriding
  the one read from imported notes (Inter DTVM's CNPJ on B3 notes; Inter&Co
  with Apex or DriveWealth custody on US confirmations);
- **dollars held abroad** on 31 December (`foreign_cash_balances`, one per
  year): the non-remunerated balance in US$ and the value in reais the user
  declares (group 06, code 01). The page offers the BCB PTAX buy rate of the
  year's last business day to convert it, never a floating-point product.
  Its exchange variation is not taxed (Lei 14.754/2023).

The calculation lives in `apps/api/src/domain/income-tax.ts`; tax-law
constants live in `packages/shared/src/income-tax.ts`.

## Tax kinds

Each ticker maps to one kind from its asset class, currency and B3 suffix:

| Kind | Rule | Assessment |
| --- | --- | --- |
| `stock` | `stock_br`, BRL, not a unit | monthly, 15%; exempt when the month's swing sales of stocks total ≤ R$ 20,000 |
| `unit` | `stock_br`, BRL, ticker ending in `11` | monthly, 15%, never exempt (units are not shares) |
| `etf` | `etf`, BRL | monthly, 15%, never exempt (equity ETF assumed) |
| `bdr` | `bdr`, BRL, or `stock_br` ending in `32`–`35`/`39` | monthly, 15%, never exempt |
| `fii` | `reit`, BRL | monthly, 20%, own loss pool, never exempt |
| `foreign` | any USD asset | yearly (Lei 14.754/2023), 15% |
| `uncovered` | crypto, fixed income, cash, other | reported as a warning, not assessed |

## Brazilian assessment (monthly)

- **Day trade.** For each BRL ticker and day, the quantity both bought and
  sold that day is a day trade. Buys and sells are paired in document order
  (first buy with first sell); each trade's fees follow its quantity. Day
  trades never touch the average cost of the position held before. The
  leftover of the day (buys or sells, never both) is an ordinary trade.
- **Ordinary results** use the moving average cost with fees included;
  proceeds are net of fees.
- **Exemption.** Gross swing sales of `stock` in the month ≤ R$ 20,000: a
  positive net stock result is exempt income (IRPF "rendimentos isentos",
  type 20); a negative one still enters the ordinary loss pool.
- **Loss pools** never expire and never mix: ordinary (stocks, units, ETFs,
  BDRs), day trade, and FII. A month's positive result first consumes its own
  pool; a negative one feeds it.
- **Tax.** 15% of the ordinary base, 20% of the day-trade base, 20% of the FII
  base, rounded to cents.
- **Withheld tax (IRRF).** Read from imported broker notes: the 0.005% on
  sales (Lei 11.033/2004) and the 1% on day trades, stored separately on the
  note. Both offset the month's tax, then later months of the same year. What
  remains on 31 December goes to the yearly declaration and is not carried.
  Manual trades have no IRRF.
- **DARF.** Tax after IRRF plus the pending amount is payable from R$ 10;
  below that it is carried to the next month, across years.

## Foreign assets (yearly)

Every USD sale's result is `proceeds × PTAX of the sale date − cost in BRL`,
where the cost in BRL is the moving average of each buy converted at its own
trade-date rate (BCB PTAX sell, Lei 14.754 art. 15 and IN RFB 2.180 art. 57).
Results of the year are netted, the foreign loss pool offsets a positive net,
and a negative net feeds the pool for later years at nominal value. The
estimated tax is 15% of the remaining base. Foreign dividends and interest
also belong to this yearly base but are out of scope; the report says so.
A USD trade without a rate makes the foreign figures incomplete, never
silently converted at another rate.

## Bonus issues (bonificação)

A bonus is a `corporate_actions` row of kind `bonus`: the shares received
become a units ratio over what the ledger held the day before the ex-date
(`from = held`, `to = held + received`), plus the cost per share the company
attributed (`unit_cost`). Every screen counts the units like a split. Only
the tax ledger adds `received × unit_cost` to the cost basis, and the report
lists it as exempt income (type 18); the positions screens keep the cash
actually paid. Only BRL share-based assets take bonuses.

## Year-end holdings (Bens e Direitos)

For 31 December of the year and of the year before: quantity, cost in BRL
from the tax ledger (and cost in USD for foreign assets), plus a suggested
description. Group/code is shown only where it is unambiguous: stocks and
units 03/01, FII 07/03, foreign stocks and REITs 03/01. ETFs and BDRs leave it
blank for the user to choose.

## Known limits

- Subscription rights, options, futures and fixed-income ETFs are not
  modeled. Fractions of a bonus sold at auction must be entered as a sale.
- The positions screens keep the plain moving average and the cash paid.
  They differ from the tax ledger for a ticker bought and sold on the same
  day and for bonus shares, whose attributed cost is fiscal only.
- The dollar balance abroad is typed by the user from the broker statement;
  dividends credited there are not tracked.

## Persistence

- `income_tax_settings` (user-owned, cascade): `start_year` plus the opening
  ordinary, day-trade, FII and foreign losses and pending DARF, all
  `numeric(22, 8)`. Included in backup v12, export/import ordering, manifest
  counts and delete-all.
- `broker_notes.day_trade_withheld_tax`: the day-trade part of `withheld_tax`.
  Notes imported earlier keep `0`, i.e. all of their IRRF counts as 0.005%.
- Backup v13 adds `darfPayments`, `assetTaxProfiles`, `foreignCashBalances`
  and `corporateActions.unitCost`; a bonus must add shares and carry a unit
  cost, a split must not. All three tables are in delete-all and the data
  summary.

## Acceptance

- Domain tests cover the exemption boundary, units, losses in exempt months,
  separate pools, day-trade pairing with an existing position, IRRF carry
  within the year and reset in January, the R$ 10 DARF carry, FII, splits,
  the start year and foreign results with missing rates.
- The report reproduces the opening balances of `ir@gmail.com` (IRPF 2025
  informe) as the 2025 year-end holdings.
