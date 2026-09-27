# Contribution score

The current engine is v3 (`DEFAULT_SCORE_CONFIG.version` `2026-09-27-v3`).
v2 replaced the v1 buckets with a gap score and a water-filling planner; v3
keeps that structure and changes how the target is tilted.

## Decision

The score and the planner answer three separate questions, each from one
input:

1. **Where to go.** The user's target, tilted twice:
   - *Valuation*: `vTilt = clamp(exp(strength × c × s), tiltMin, tiltMax)`,
     with `s = ln(fairValue / price)` (no dead zone by default), a positive
     signal reduced by the FX spread and IOF of a USD asset, and
     `c = min(grade multiplier, 1) × 0.5 ^ (age / fairValueHalfLifeQuarters)`.
     Renormalized only among assets with a fair value, so a costly asset's
     weight moves to other valued assets, never away from ETFs or anything
     without a valuation.
   - *Momentum*: `mTilt = exp(momentumWeight × z)`, where `z` is the
     cross-sectional z-score of the 12-1 month log return, capped at
     `±momentumZCap`, renormalized across the book. With `0.10` and `±2` the
     raw factor stays within ×0.82–×1.22: a tie-breaker between buying dips
     and following trends, not a strategy. Renormalization divides by the
     target-weighted mean factor, so a small target can land slightly outside
     that range, and an asset without a year of prices (`z = null`) still
     moves by the rebalance alone; the UI labels that "book rebalance", not
     trend.
   The residual `CASH` target is never tilted. Tilted targets keep the sum of
   the original targets.
2. **How much is missing.** `relativeGap = 1 - weight / tiltedTarget`.
3. **How urgently.** `priority = gradeMultiplier × recencyMultiplier`, as in
   v2 (interpolated grade knots, recency-weighted evidence shrunk toward the
   ungraded multiplier, cooldown ramp).

`score = max(relativeGap, 0) × priority`. Trims require an expensive tilt and
a weight past the 5/25 tolerance band of the **trim target**:
`max(tiltedTarget, target × own valuation tilt)`. Renormalization shrinks a
fairly priced asset's target whenever another valued asset is cheap; that
alone must never make it a trim or sale candidate.

### Learned valuation strength

`strength = valuationSensitivity × confidence`, where confidence comes from
the investor's own track record (`apps/api/src/domain/valuation-skill.ts`):

- each fair value is anchored on the day it was known: the later of its
  quarter end and the review's last edit (America/Sao_Paulo). Reviews are
  written after the quarter's results, so the quarter-end close would credit
  price moves the investor had already seen. Any edit re-anchors the review,
  which delays evidence but never inflates it;
- fair values are rescaled by every recorded split after that day, because
  provider histories are split adjusted;
- each fair value is paired with `ln(price 12 months after the anchor /
  price on the anchor)`; reviews whose outcome is still in the future are
  pending, never guessed, and due reviews whose prices could not be loaded
  are counted as `missing`;
- the series starts ten days before the oldest anchor, so an anchor on a
  weekend or holiday still finds its prior close;
- the information coefficient is the pooled correlation of
  `ln(fairValue / anchor price)` and that outcome, demeaned within each
  review quarter (market-wide moves never count as skill) and using only
  quarters with at least three assets;
- `shrunkIC = (pairs × IC + icPriorPairs × icPrior) / (pairs + icPriorPairs)`
  and `confidence = clamp(shrunkIC / icReference, 0, 1)`.

With no history the prior gives confidence `0.5`, so strength is `1.5` of a
possible `3`. A track record with no skill drives strength to `0`, which
turns the score into plain gap filling.

Back-filling old quarters with today's knowledge would inflate the IC; the
edit-day anchor treats such a review as written today.

### Review nudge

`reviewSuggested` when `|price / reference − 1| ≥ reviewDrift` (25%), where
the reference is the close on the fair value's anchor day. The UI asks for a
fresh valuation; the score itself is unchanged.

### Sales

`apps/api/src/domain/sell-plan.ts` lists, separately from contributions,
positions priced above their fair value whose weight exceeds
`trimTarget × (1 + sellBand)`, trimmed toward the trim target:

- Brazilian stocks (`stock_br`, BRL) are fitted inside what is left of the
  R$ 20,000 monthly exemption after this month's gross sales, scaled by one
  common share and rounded to whole units; once the exemption is used up
  they are listed as taxable like every other class;
- every other class is listed as taxable information only;
- sales are *recommended* only once confidence reaches `sellConfidence`
  (0.8) over a complete track record (`missing = 0`). Before that they are
  informational: in the study, selling on biased fair values lost money,
  while simply not contributing did not.

Nothing is saved until the user registers a sale.

### Ceilings and planner

The planner is unchanged from v2: contribution-only rebalancing solved by one
water level over `priority × (held + x − target)² / target`, with room
bounded by the need, the weight ceilings, the share cap and the starter
fraction. v3 raises `overweightBlockFactor` from `1.3` to `2` so a generous
tilt can actually be reached; targets up to the absolute cap (5%) still stop
at the cap.

### Market data

Momentum and reference prices come from the quote provider's daily series in
the same request as quotes. They are not persisted. When a series is missing
the asset gets no momentum tilt and no review nudge, the response lists it
under `marketSignals.unavailable`, and the Allocation screen says so. Manual
quotes have no real history (the manual provider returns a flat line), so
with them the signals are off (`marketSignals.available = false`) instead of
computed from it.

## Evidence

A throwaway Monte Carlo (8 market regimes × 6 valuation qualities × 3,000
ten-year scenarios, R$ 280k book plus R$ 5k a month) compared v1, v2 and v3:

- a fixed valuation strength either wastes accurate fair values or amplifies
  biased ones; strength scaled by a shrunk IC captured most of the upside
  with good valuations and fell back to gap filling with bad ones;
- momentum stronger than `0.10` lost in fast mean-reverting markets; `0.10`
  helped in trending markets and cost little elsewhere;
- selling expensive positions only paid off once the valuation IC was high,
  hence the `sellConfidence` bar.

The harness is not part of the repository.

## Compatibility

- Migration `0012` adds the v3 policy fields, backfills existing custom
  policies with the v3 defaults and makes the columns `NOT NULL`. Custom
  policies keep their saved `valuationSensitivity`, so strength remains
  `sensitivity × confidence` for them.
- Backup format v10 exports the v3 fields. v1 and v2 score records import
  with the v3 defaults for fields they lack; migrations 0010/0012 instead
  kept the v2 values of policies already stored. Every imported policy must
  pass `scoreConfigUpdateSchema`, so a restore can never leave the account
  with a policy the engine rejects.
- The update schema bounds the new knobs (`momentumWeight ≤ 1`,
  `momentumZCap ≤ 5`, `icReference ≤ 1`, `|icPrior| ≤ 1`, integer knobs
  within their columns); the engine also bounds the momentum exponent so a
  stored extreme value cannot overflow decimals.

## Not implemented

- Rolling a fair value forward by cost of equity between reviews.
- Currency- or category-level targets.
- Persisted price history for the IC: recomputed from the provider series on
  each request until a measured need appears.
- Tax-aware sales outside the Brazilian stock exemption.

## Acceptance criteria

- Tilted targets sum to the original targets; a single-asset book returns its
  target exactly.
- A cheaper price never lowers a score; grades one hundredth apart never move
  a multiplier by more than the curve slope.
- No fair value outcome is used before 12 months after the day it was known.
- Raw momentum factors stay within `exp(±momentumWeight × momentumZCap)`.
- A trim or sale never takes an asset below `target × own valuation tilt`.
- Exempt sale suggestions never exceed what is left of the monthly
  exemption, and are not marked recommended below `sellConfidence` or with a
  partial track record.
- The planner conserves money and never exceeds a need or a weight ceiling.
