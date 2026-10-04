# Goals, contribution history and money-weighted return

## Decisions

- **One goal per account** (`financial_goals`, keyed by user, cascade). It
  stores the planned monthly contribution, the target as a monthly income or a
  portfolio value (`target_kind` + `target_amount`), the yearly withdrawal
  rate, three real yearly returns (conservative ≤ base ≤ optimistic, 0–20%)
  and an optional `YYYY-MM` target month. Amounts carry their own currency;
  the overview converts them into the display currency at today's rate.
  Defaults: 4% withdrawal, 2% / 4% / 6% real returns.
- **Real terms.** Returns are above inflation, so every projected amount is in
  today's money and no inflation series or provider is needed. An income goal
  becomes a value goal as `income × 12 / withdrawal rate`.
- **Projection** (`domain/goals.ts`): month by month the value grows at
  `(1 + yearly)^(1/12) − 1`, then the month's contribution lands. The monthly
  rate is the only float (the twelfth root) and is rounded to 8 places;
  compounding is decimal. It runs up to `GOAL_MAX_YEARS` (60): a goal beyond
  that is "not reached". With a target month it also reports the value at
  that month and the contribution that reaches the goal exactly then
  (annuity formula, never negative).
- **Today's value** is `summarizePositions(...).totalMarketValue` of the live
  book: quoted holdings, fixed-income balances and cash. Unquoted holdings are
  left out and disclosed.
- **Contributions are derived, not recorded**: per month, buys with fees minus
  sale proceeds across every asset class, fixed income included, converted at
  each trade's stored rate or today's rate when it has none (disclosed). There
  is no cash ledger, so a sale reinvested in a later month reads as a
  withdrawal then a contribution, reinvested dividends count as new money, and
  cash balance edits do not count. The UI says so. The "last 12 months"
  figures use complete months only.
- **Money-weighted return (XIRR)** sits next to the time-weighted return on
  Performance, over the same flows and values: the baseline month-end value as
  a contribution on the baseline day, every non-fixed-income trade on its day,
  the last month-end value as the end. Bisection on `[-99%, +1000%]` a year;
  `null` under 182 days or without a root. Floats are confined to the root
  search; the result is a display ratio, never stored.

## Persistence

`financial_goals` is in backup v14 (record validated against the live
`goalSettingsInput`, at most one row), export/import ordering, manifest
counts, `data.summary` and delete-all.

## Not done

- A contribution journal (why each contribution was made, planner suggestion
  vs executed trades) needs its own table; it is P8 of the allocation study.
- Dividends are not cash flows yet, so both returns and the contribution
  history inherit that gap until income is recorded as received.
