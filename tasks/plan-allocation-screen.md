# Allocation screen — what shipped and how to change it

Replaces the spreadsheet used to decide the next contribution. Route
`/allocation`, under the **Portfolio** nav group.

---

## 1. The screen

One dense, editable table plus a contribution planner.

| Column | Source | Editable |
|---|---|---|
| Asset | position or watch-only row | — |
| Target | `allocation_assets.target_weight` | inline, percent |
| Current | `ValuedPosition.weight` (share of quoted equity) | — |
| Gap | `target - current` | — |
| Score | score engine | — |
| Grade | average of the newest graded quarters | — |
| Discount | `(fairValue - marketPrice) / fairValue` | — (computed) |
| Last buy | newest **buy** in the trade log | — |
| Shares / Value | consolidated position | — |
| Fair value | `allocation_assets.fair_value` — per-share target from the user's valuation | inline, money |
| `Qn YY` grid | `asset_reviews` (grade + notes per quarter) | popover per cell |

Interactions:

- **Sorting** — every column, click to toggle direction. Rows with no value
  for the sorted column sink to the bottom. Default sort is score, descending.
- **Free order** — a switch that turns sorting off and shows a drag handle per
  row. Drag, or focus a handle and use the arrow keys; the row menu also has
  move up/down. The rank persists in `allocation_assets.sort_order`.
- **Quarter window** — `◀ ▶` moves the visible quarters, and 3/5/8 columns are
  available. It defaults to the newest reviewed quarter (or the last completed
  one), because earnings lag the calendar.
- **Watch-only assets** — "Add asset" registers a ticker with no trades. It is
  priced like any other row and can already carry a target and a fair value, so
  the score ranks it against invested assets. "Stop following" removes it (and
  its reviews); an invested ticker keeps its row and only clears its metadata.
- **Contribution planner** — an amount split proportionally to the score
  across the top *n* candidates, with the suggested unit count per asset. It is
  a suggestion: amounts are rounded to cents with the remainder reported, and
  nothing is persisted until the trade is registered in `/transactions`.

Cell editors take localized text (`1,5`, `-23,55`, `1.234,56%`) and convert it
to exact decimal strings by *moving the decimal point*
(`apps/web/src/lib/numeric-input.ts`), never by multiplying floats.

---

## 2. Score engine — the part that will change

`apps/api/src/domain/score.ts`, with every threshold in
`DEFAULT_SCORE_CONFIG` (`packages/shared/src/score.ts`).

The score is in **weight units**: `0.0075` means the asset is 0.75 percentage
points of portfolio away from where it should be. Negative means trim, `0`
means skip.

Rules are an ordered array; the first match wins:

| # | Rule | Score |
|---|---|---|
| 1 | `no-target` — no target weight | `0` |
| 2 | `trim-overweight` — `discount < 0` and `weight > target * 1.2` | `adjustedTarget - weight` (negative) |
| 3 | `weight-cap` — `weight > 5%` | `0`, blocked |
| 4 | `target-overweight` — `weight > target * 1.3` | `0`, blocked |
| 5 | `cooldown` — last buy under 45 days ago | `0`, blocked |
| 6 | `gap-weighted` — the normal case | `max(0, adjustedTarget - weight) * gradeMultiplier` |

where `adjustedTarget = target * (1 + discount)`.

Grade bands (approximate `VLOOKUP` in the sheet, ported as bands):

| Average grade | Multiplier |
|---|---|
| 0–3.99 | 0.5 |
| 4–6.99 | 0.7 |
| 7–7.99 | 0.8 |
| 8–10 | 1.0 |
| ungraded | 1.0 |

The average covers the newest `gradeWindowQuarters` (4) **graded** reviews, so
it never moves when the visible quarter window changes.

**To change the policy:**

1. a different threshold → edit `DEFAULT_SCORE_CONFIG` and bump its `version`
   (the screen footer shows it);
2. a different rule, or a new one → add/reorder an entry in `SCORE_RULES`. A
   rule only reads `ScoreContext` and `ScoreConfig`;
3. a new intermediate value the UI should explain → add it to
   `scoreBreakdownSchema`, which travels with every row.

Nothing outside `score.ts` decides a score. `scoreAsset` is the only entry
point, and `apps/api/src/domain/score.test.ts` pins each rule.

One deliberate difference from the spreadsheet: an asset with **no** target
scores `0` instead of being treated as a `0%` target, which in the sheet could
turn any untargeted holding into a trim signal.

---

## 3. Data model

```text
allocation_assets(user_id, ticker) unique
  target_weight numeric(22,8) nullable          -- ratios, 0.015 = 1.5%
  fair_value numeric(22,8) nullable             -- per-share valuation target
  valuation_ref text nullable                   -- optional write-up pointer
  sort_order integer                            -- free-order rank

asset_reviews(user_id, ticker, period) unique
  period text                                   -- 'YYYYQn', sorts by text
  grade numeric(22,8) nullable                   -- 0-10
  notes text nullable
```

Discount is not stored: `buildAllocationRows` computes
`(fair_value - market_price) / fair_value` and feeds that into the score
engine. Migration `0003_fair_value.sql` replaced the old user-entered
`discount` column.

A row in `allocation_assets` with no matching transaction *is* a watch-only
asset — there is no separate flag. The table lists the union of open positions
and metadata rows.

## 4. API

`allocation.list` (targets + positions + reviews + scores + summary),
`upsertAsset` (patch semantics: omitted keeps, `null` clears), `removeAsset`,
`reorder`, `upsertReview`, `removeReview`.

`list` reuses `apps/api/src/trpc/valuation.ts` (`loadValuedPortfolio`), which
`positions.list` also uses now, and additionally quotes the watch-only tickers
so they carry a price with no position to value.

## 5. Not in scope here

A full valuation screen behind the fair value, and a per-user override of
the score config (the config ships as constants for now).
