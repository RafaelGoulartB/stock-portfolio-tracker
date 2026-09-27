# Contribution score v2

## Decision

The score and the planner answer three separate questions, each from one
input:

1. **Where to go.** The user's target, tilted by valuation and renormalized
   across the book: `tilt = clamp(exp(k × c × s), tiltMin, tiltMax)`, where
   `s = ln(fairValue / price)` soft-thresholded by `valuationDeadZone`
   (valuation noise, 5% by default) and, when positive, reduced by the FX
   spread and IOF of a USD asset. Confidence `c = min(grade multiplier, 1) × 0.5 ^ (age /
   fairValueHalfLifeQuarters)`. Tilted targets are rescaled so they keep the
   sum of the original targets; the residual `CASH` target is never tilted.
   This is a simplified Black–Litterman blend: target as prior, fair value as
   view, confidence as view weight.
2. **How much is missing.** `relativeGap = 1 - weight / tiltedTarget`, so an
   empty small target outranks a nearly full large one with the same
   percentage-point gap.
3. **How urgently.** `priority = gradeMultiplier × recencyMultiplier`. The
   grade multiplier interpolates the configured knots, averages grades with a
   `gradeHalfLifeQuarters` recency weight, and shrinks toward the ungraded
   multiplier by `gradePriorQuarters` of evidence. The cooldown ramps priority
   from `cooldownFloor` to `1` instead of blocking.

`score = max(relativeGap, 0) × priority`. Trims require an expensive tilt
(`< 1`) and a weight past the tighter of `trimAbsoluteBand` points or
`trimRelativeBand` of the tilted target (5/25 tolerance bands). The absolute
cap and `target × overweightBlockFactor` block the score and are also the
planner's post-contribution weight ceilings.

The planner solves contribution-only rebalancing as
`minimize Σ priority × (held + x - target)² / target` with `Σ x = C` and
`0 ≤ x ≤ room`, where every target is measured against `V + C`. KKT gives
`x = clamp(need - θ × target / priority, 0, room)` for one water level `θ`,
solved exactly on the piecewise-linear sum. Room is the need, the weight
ceilings, the share cap with two or more seats, and `starterFraction` of the
target for an asset not yet held (except on an empty book). Automatic mode
keeps the minimum-impact seat count, releases sub-minimum seats down to two,
and seats the next ranked name while money is left.

## Compatibility

- Migration `0010` backfills custom policies: `trim_relative_band =
  trim_factor - 1`, every new knob at its default; `0011` drops
  `trim_factor`. Planner policies gain `starter_fraction = 0.5`.
- Backup format v9 exports the v2 fields. v1 score records and planner
  records without `starterFraction` import with the same mapping.

## Not implemented

- Rolling a fair value forward by cost of equity between reviews: it needs a
  per-asset discount rate and dividend data. Staleness decay covers the risk
  of acting on an old fair value.
- Currency- or category-level targets and a momentum filter: each needs its
  own plan and data.
- A historical backtest harness in the repository. The defaults were chosen
  with a throwaway 200-scenario Monte Carlo (mean-reverting prices, fair
  values with 10% or 25% error, monthly contributions for five years)
  comparing v1 and v2: v2 lowered tracking error to target in about 87% of
  scenarios and left no money idle; a 10% noise band gave up value capture
  when fair values were accurate, so the default band is 5%.

## Acceptance criteria

- Grades one hundredth apart never move a multiplier by more than the curve
  slope; a cheaper price never lowers a score.
- Tilted targets sum to the original targets.
- The planner conserves money (`allocated + remainder = amount`) and never
  exceeds a need or a weight ceiling.
- A single-asset book returns its target exactly: valuation only moves
  weight between assets.
