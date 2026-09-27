import {
  CONTRIBUTION_PLAN_LARGE_BOOK_VALUE,
  CONTRIBUTION_PLAN_SMALL_BOOK_VALUE,
  type ContributionPlanConfig,
  type Currency,
  DEFAULT_CONTRIBUTION_PLAN_CONFIG,
} from "@portifolio-tracker/shared";
import {
  add,
  type Decimal,
  div,
  formatDecimal,
  mul,
  SCALE,
  sub,
  toDecimal,
  ZERO,
} from "../lib/decimal";

const MONEY_PLACES = 2;
const WEIGHT_PLACES = 8;
const UNIT_PLACES = 4;
const UNIT = 10n ** BigInt(SCALE);
const ONE_CENT = toDecimal("0.01");
const HALF = toDecimal("0.5");

export type ContributionPlanRow = {
  ticker: string;
  currency: Currency;
  /** Contribution score. Only positive values compete. */
  score: string;
  /** Score priority (grade × cooldown ramp). Higher fills closer to target. */
  priority: string;
  /** Valuation-tilted target weight, `null` without a target. */
  tiltedTarget: string | null;
  /** Current share of the portfolio, `0`–`1`. */
  currentWeight: string;
  /** Highest weight a contribution may take the asset to, `null` for none. */
  maxWeight: string | null;
  /** False for a watch-only asset, whose first cheque is a starter slice. */
  held: boolean;
  executionPrice: string | null;
  executionFxApplied: boolean;
  /** True when the market only trades whole units (B3 shares, FIIs, BDRs). */
  wholeUnits: boolean;
};

export type ContributionSlice = {
  ticker: string;
  currency: Currency;
  /** Share of the contribution after cent rounding, `0`–`1`. */
  share: string;
  /** Suggested amount in the display currency, rounded to cents. */
  amount: string;
  /** Suggested unit count, `null` when the asset has no price. */
  units: string | null;
  executionFxApplied: boolean;
  /** True when the 70%-style share cap bound this slice. */
  cappedByShare: boolean;
  /** True when the slice reached the asset's tilted target. */
  cappedByNeed: boolean;
  /** True when a weight ceiling or the starter size bound this slice. */
  cappedByLimit: boolean;
};

export type ContributionSpreadMode = "auto" | "manual" | "all";

export type ContributionPlanResult = {
  slices: ContributionSlice[];
  /** Sum of suggested slice amounts, cents. */
  allocated: string;
  /** `amount - allocated`, cents. Includes need-ceiling leftover. */
  remainder: string;
  /** Part of {@link remainder} left because slices buy whole units only. */
  unitRoundingRemainder: string;
  /** How the candidate count was chosen. */
  spreadMode: ContributionSpreadMode;
  /** Count the formula or override aimed for, before the need filter. */
  targetCount: number;
  /** Names that actually received a seat. */
  selectedCount: number;
  /** `amount / portfolioValue`, `null` when the book is empty. */
  relativeSize: string | null;
  /**
   * Effective min-weight impact used for this book size, `null` when the
   * book is empty and the small-book impact is used only as a cap.
   */
  weightImpact: string | null;
};

export type ContributionPlanInput = {
  rows: readonly ContributionPlanRow[];
  /** Display-currency contribution. */
  amount: string;
  /** Quoted portfolio market value in the same currency. */
  portfolioValue: string;
  config?: ContributionPlanConfig;
  /**
   * `null` / omitted runs the automatic count. `0` means every positive-score
   * candidate. A positive integer takes that many top names.
   */
  spread?: number | null;
};

/**
 * One competing asset, in display-currency money against the book *after*
 * the contribution (`V' = V + C`): contributing dilutes every weight, so the
 * money an asset needs is `tiltedTarget × V' - held`, not `gap × V'`.
 */
type Candidate = {
  row: ContributionPlanRow;
  priority: Decimal;
  /** `tiltedTarget × V'`. */
  target: Decimal;
  /** `target - held`: money that brings the asset exactly to target. */
  need: Decimal;
  /** Room under the weight ceiling and the starter size, capped by need. */
  limit: Decimal;
  /** Water-filling order: `priority × need / target`. */
  index: Decimal;
};

type Solved = {
  candidate: Candidate;
  cap: Decimal;
  allocated: Decimal;
  cappedByShare: boolean;
  cappedByNeed: boolean;
  cappedByLimit: boolean;
};

function wholeCount(value: Decimal): bigint {
  return value < ZERO ? 0n : value / UNIT;
}

function minOf(a: Decimal, b: Decimal): Decimal {
  return a < b ? a : b;
}

function toCandidates(
  rows: readonly ContributionPlanRow[],
  portfolioValue: Decimal,
  postValue: Decimal,
  config: ContributionPlanConfig,
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const row of rows) {
    const priority = toDecimal(row.priority);

    if (
      toDecimal(row.score) <= ZERO ||
      priority <= ZERO ||
      row.tiltedTarget === null
    ) {
      continue;
    }

    const target = mul(toDecimal(row.tiltedTarget), postValue);
    const held = mul(toDecimal(row.currentWeight), portfolioValue);
    const need = sub(target, held);

    if (target <= ZERO || need <= ZERO) continue;

    let limit = need;

    if (row.maxWeight !== null) {
      limit = minOf(limit, sub(mul(toDecimal(row.maxWeight), postValue), held));
    }

    // A new position is built over several cheques. An empty book has no
    // "existing" positions to protect, so its first cheque is not limited.
    if (!row.held && portfolioValue > ZERO) {
      limit = minOf(
        limit,
        sub(mul(toDecimal(config.starterFraction), target), held),
      );
    }

    if (limit < ONE_CENT) continue;

    candidates.push({
      row,
      priority,
      target,
      need,
      limit,
      index: div(mul(priority, need), target),
    });
  }

  return candidates.sort((a, b) => {
    if (a.index !== b.index) return a.index > b.index ? -1 : 1;
    return a.row.ticker.localeCompare(b.row.ticker);
  });
}

/** No slice at all: the whole (positive) amount stays unallocated. */
function emptyResult(
  spreadMode: ContributionSpreadMode,
  amount: Decimal,
  targetCount = 0,
  weightImpact: string | null = null,
): ContributionPlanResult {
  return {
    slices: [],
    allocated: formatDecimal(ZERO, MONEY_PLACES),
    remainder: formatDecimal(amount > ZERO ? amount : ZERO, MONEY_PLACES),
    unitRoundingRemainder: formatDecimal(ZERO, MONEY_PLACES),
    spreadMode,
    targetCount,
    selectedCount: 0,
    relativeSize: null,
    weightImpact,
  };
}

/**
 * Log-interpolates the min-weight impact between the small-book and
 * large-book knobs. `t` is dimensionless so a JS logarithm is enough; the
 * result is mixed back into decimal weights.
 */
export function weightImpactForPortfolio(
  portfolioValue: Decimal,
  config: ContributionPlanConfig = DEFAULT_CONTRIBUTION_PLAN_CONFIG,
): Decimal {
  const small = toDecimal(config.smallBookImpact);
  const large = toDecimal(config.largeBookImpact);
  const smallBook = toDecimal(CONTRIBUTION_PLAN_SMALL_BOOK_VALUE);
  const largeBook = toDecimal(CONTRIBUTION_PLAN_LARGE_BOOK_VALUE);

  if (portfolioValue <= smallBook) return small;
  if (portfolioValue >= largeBook) return large;

  const value = Number(formatDecimal(portfolioValue, WEIGHT_PLACES));
  const span =
    Math.log(Number(CONTRIBUTION_PLAN_LARGE_BOOK_VALUE)) -
    Math.log(Number(CONTRIBUTION_PLAN_SMALL_BOOK_VALUE));
  const t =
    (Math.log(value) - Math.log(Number(CONTRIBUTION_PLAN_SMALL_BOOK_VALUE))) /
    span;

  return add(
    small,
    mul(toDecimal(t.toFixed(WEIGHT_PLACES)), sub(large, small)),
  );
}

/**
 * How many names a contribution may touch.
 *
 * Auto: `clamp(round(C / (V × impact(V))), 1, maxAssets)`, so a second name
 * opens at 1.5× a minimum slice rather than waiting for a full 2×. An empty
 * book is treated as large relative size so the first cheque can diversify.
 */
export function targetContributionCount(
  amount: Decimal,
  portfolioValue: Decimal,
  candidateCount: number,
  config: ContributionPlanConfig,
  spread: number | null | undefined,
): {
  count: number;
  mode: ContributionSpreadMode;
  relativeSize: Decimal | null;
  weightImpact: Decimal | null;
} {
  if (candidateCount <= 0) {
    return { count: 0, mode: "auto", relativeSize: null, weightImpact: null };
  }

  if (spread === 0) {
    return {
      count: candidateCount,
      mode: "all",
      relativeSize: portfolioValue > ZERO ? div(amount, portfolioValue) : null,
      weightImpact:
        portfolioValue > ZERO
          ? weightImpactForPortfolio(portfolioValue, config)
          : null,
    };
  }

  if (spread != null && spread > 0) {
    return {
      count: Math.min(spread, candidateCount),
      mode: "manual",
      relativeSize: portfolioValue > ZERO ? div(amount, portfolioValue) : null,
      weightImpact:
        portfolioValue > ZERO
          ? weightImpactForPortfolio(portfolioValue, config)
          : null,
    };
  }

  if (portfolioValue <= ZERO) {
    return {
      count: Math.min(config.maxAssets, candidateCount),
      mode: "auto",
      relativeSize: null,
      weightImpact: null,
    };
  }

  const impact = weightImpactForPortfolio(portfolioValue, config);
  const minSlice = mul(portfolioValue, impact);
  let count = 1;

  if (minSlice > ZERO) {
    const rounded = wholeCount(add(div(amount, minSlice), HALF));
    if (rounded > 1n) {
      count =
        rounded > BigInt(config.maxAssets) ? config.maxAssets : Number(rounded);
    }
  }

  return {
    count: Math.min(count, candidateCount),
    mode: "auto",
    relativeSize: div(amount, portfolioValue),
    weightImpact: impact,
  };
}

/**
 * Contribution-only rebalancing as a constrained least-squares problem:
 *
 * `minimize Σ priority × (held + x - target)² / target`
 * subject to `Σ x = total` and `0 ≤ x ≤ cap`.
 *
 * The KKT conditions give `x = clamp(need - θ × target / priority, 0, cap)`
 * for one water level `θ ≥ 0`: every funded asset ends at the same
 * priority-weighted *relative* fill, so a small target that is empty is
 * funded before a large target that is nearly full, and a higher priority
 * ends closer to its target. `Σ x(θ)` is piecewise linear, so `θ` is solved
 * exactly between breakpoints instead of by iteration.
 */
function waterFill(
  candidates: readonly Candidate[],
  total: Decimal,
  shareCap: Decimal | null,
): { solved: Solved[]; leftover: Decimal } {
  const items = candidates.map((candidate) => {
    const cap =
      shareCap === null ? candidate.limit : minOf(candidate.limit, shareCap);

    return {
      candidate,
      cap,
      slope: div(candidate.target, candidate.priority),
    };
  });
  const at = (theta: Decimal) =>
    items.map(({ candidate, cap, slope }) => {
      const raw = sub(candidate.need, mul(theta, slope));

      return raw < ZERO ? ZERO : raw > cap ? cap : raw;
    });
  const sum = (values: readonly Decimal[]) =>
    values.reduce((acc, value) => add(acc, value), ZERO);

  let allocation = at(ZERO);
  let used = sum(allocation);

  if (used > total) {
    const breakpoints = new Set<Decimal>();

    for (const { candidate, cap, slope } of items) {
      breakpoints.add(div(candidate.need, slope));
      if (cap < candidate.need) {
        breakpoints.add(div(sub(candidate.need, cap), slope));
      }
    }

    let previous = ZERO;
    let previousSum = used;

    for (const point of [...breakpoints].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      if (point <= previous) continue;

      const pointSum = sum(at(point));

      if (pointSum <= total) {
        const theta = add(
          previous,
          div(
            mul(sub(previousSum, total), sub(point, previous)),
            sub(previousSum, pointSum),
          ),
        );
        allocation = at(theta);
        break;
      }

      previous = point;
      previousSum = pointSum;
    }

    // The level is exact up to 8-place rounding; settle the sub-cent drift
    // on slices strictly between zero and their cap (the ones the level
    // actually sets), so a capped slice keeps its exact cap.
    let drift = sub(total, sum(allocation));

    for (let index = 0; index < items.length && drift !== ZERO; index += 1) {
      const item = items[index];
      const current = allocation[index];

      if (!item || current === undefined) continue;
      if (current <= ZERO || current >= item.cap) continue;

      const next = add(current, drift);
      const bounded = next < ZERO ? ZERO : next > item.cap ? item.cap : next;
      drift = sub(drift, sub(bounded, current));
      allocation[index] = bounded;
    }

    used = sum(allocation);
  }

  const solved = items.map(({ candidate, cap }, index): Solved => {
    const allocated = allocation[index] ?? ZERO;
    const atCap = allocated > ZERO && allocated === cap;

    return {
      candidate,
      cap,
      allocated,
      cappedByShare: atCap && shareCap !== null && shareCap < candidate.limit,
      cappedByNeed: atCap && cap === candidate.need,
      cappedByLimit:
        atCap && cap === candidate.limit && candidate.limit < candidate.need,
    };
  });

  return { solved, leftover: sub(total, used) };
}

function shareCapFor(
  size: number,
  amount: Decimal,
  config: ContributionPlanConfig,
): Decimal | null {
  return size > 1 ? mul(amount, toDecimal(config.maxShare)) : null;
}

/**
 * Auto mode first seats the best-ranked names whose room is at least a
 * meaningful slice of the book, so a crumb-sized need never takes a seat.
 * Manual and "all" keep the ranked list intact.
 */
function inviteCandidates(
  ranked: readonly Candidate[],
  targetCount: number,
  mode: ContributionSpreadMode,
  minSlice: Decimal,
): Candidate[] {
  if (targetCount <= 0 || ranked.length === 0) return [];
  if (mode !== "auto" || minSlice <= ZERO) return ranked.slice(0, targetCount);

  const invited = ranked
    .filter((candidate) => candidate.limit >= minSlice)
    .slice(0, targetCount);

  return invited.length > 0 ? invited : ranked.slice(0, 1);
}

/**
 * Solves the seated names, then:
 *
 * - in auto mode, gives up a seat whose slice is below the minimum impact
 *   when the others can absorb its money (fewer, meaningful orders), down
 *   to two seats;
 * - while money is left because every seat is at its cap, seats the next
 *   ranked name, up to `maxAssets`.
 */
function allocate(
  ranked: readonly Candidate[],
  invited: readonly Candidate[],
  amount: Decimal,
  mode: ContributionSpreadMode,
  minSlice: Decimal,
  config: ContributionPlanConfig,
): { solved: Solved[]; leftover: Decimal } {
  let seats = [...invited];
  let result = waterFill(
    seats,
    amount,
    shareCapFor(seats.length, amount, config),
  );

  // Never prune below two seats: collapsing to one name would also lift the
  // share cap that keeps a single asset from taking the whole cheque.
  while (mode === "auto" && minSlice > ZERO && seats.length > 2) {
    const crumbs = result.solved
      .filter((item) => item.allocated > ZERO && item.allocated < minSlice)
      .sort((a, b) => (a.candidate.index < b.candidate.index ? -1 : 1));
    const drop = crumbs[0];

    if (!drop) break;

    const rest = seats.filter((seat) => seat !== drop.candidate);
    const restShare = shareCapFor(rest.length, amount, config);
    const capacity = rest.reduce(
      (sum, seat) =>
        add(
          sum,
          restShare === null ? seat.limit : minOf(seat.limit, restShare),
        ),
      ZERO,
    );

    if (capacity < sub(amount, result.leftover)) break;

    seats = rest;
    result = waterFill(seats, amount, restShare);
  }

  for (const candidate of ranked) {
    if (result.leftover < ONE_CENT || seats.length >= config.maxAssets) break;
    if (seats.includes(candidate)) continue;

    seats = [...seats, candidate];
    result = waterFill(
      seats,
      amount,
      shareCapFor(seats.length, amount, config),
    );
  }

  return result;
}

function wholeUnitPrice(row: ContributionPlanRow): Decimal | null {
  if (!row.wholeUnits || row.executionPrice === null) return null;
  const price = toDecimal(row.executionPrice);

  return price > ZERO ? price : null;
}

/**
 * Whole-unit markets cannot buy a fraction of a share: each such slice is
 * floored to whole units, then the freed money buys one more unit at a
 * time, best-ranked first, only where the slice's cap still has room. The
 * money that cannot buy another unit is returned, never spread elsewhere.
 */
function roundToWholeUnits(items: Solved[]): Decimal {
  let freed = ZERO;

  for (const item of items) {
    const price = wholeUnitPrice(item.candidate.row);
    if (price === null) continue;

    const rounded = wholeCount(div(item.allocated, price)) * price;
    freed = add(freed, sub(item.allocated, rounded));
    item.allocated = rounded;
  }

  let bought = true;

  while (bought) {
    bought = false;

    for (const item of items) {
      const price = wholeUnitPrice(item.candidate.row);
      if (price === null || price > freed) continue;
      if (add(item.allocated, price) > item.cap) continue;

      item.allocated = add(item.allocated, price);
      freed = sub(freed, price);
      bought = true;
    }
  }

  return freed;
}

/**
 * Splits a contribution across the assets the score considers candidates.
 *
 * Amounts are a *suggestion*, never an accounting record: they are rounded
 * to cents at the end and any remainder — rounding dust, money no candidate
 * has room for, or whole-unit leftovers — is reported instead of silently
 * disappearing. Money that actually moves is entered as a transaction.
 */
export function planContribution(
  input: ContributionPlanInput,
): ContributionPlanResult {
  const config = input.config ?? DEFAULT_CONTRIBUTION_PLAN_CONFIG;
  const amount = toDecimal(input.amount);
  const portfolioValue = toDecimal(input.portfolioValue);
  const postValue = add(portfolioValue, amount);
  const spreadModeGuess: ContributionSpreadMode =
    input.spread === 0
      ? "all"
      : input.spread != null && input.spread > 0
        ? "manual"
        : "auto";

  if (amount <= ZERO) {
    return emptyResult(spreadModeGuess, ZERO);
  }

  const ranked = toCandidates(input.rows, portfolioValue, postValue, config);

  if (ranked.length === 0) {
    return emptyResult(spreadModeGuess, amount);
  }

  const {
    count: targetCount,
    mode,
    relativeSize,
    weightImpact,
  } = targetContributionCount(
    amount,
    portfolioValue,
    ranked.length,
    config,
    input.spread,
  );
  const minSlice =
    mode === "auto" && portfolioValue > ZERO && weightImpact !== null
      ? mul(portfolioValue, weightImpact)
      : ZERO;
  const invited = inviteCandidates(ranked, targetCount, mode, minSlice);
  const impactText =
    weightImpact === null ? null : formatDecimal(weightImpact, WEIGHT_PLACES);

  if (invited.length === 0) {
    return {
      ...emptyResult(mode, amount, targetCount, impactText),
      relativeSize:
        relativeSize === null
          ? null
          : formatDecimal(relativeSize, WEIGHT_PLACES),
    };
  }

  const { solved } = allocate(ranked, invited, amount, mode, minSlice, config);
  const unitRoundingRemainder = roundToWholeUnits(solved);

  let allocated = ZERO;
  const slices: ContributionSlice[] = solved
    .filter((item) => item.allocated > ZERO)
    .sort((a, b) => {
      if (a.allocated !== b.allocated)
        return a.allocated > b.allocated ? -1 : 1;
      return a.candidate.row.ticker.localeCompare(b.candidate.row.ticker);
    })
    .map((item) => {
      const { row } = item.candidate;
      const sliceAmount = toDecimal(
        formatDecimal(item.allocated, MONEY_PLACES),
      );
      allocated = add(allocated, sliceAmount);
      const price =
        row.executionPrice === null ? null : toDecimal(row.executionPrice);

      return {
        ticker: row.ticker,
        currency: row.currency,
        share: formatDecimal(div(sliceAmount, amount), WEIGHT_PLACES),
        amount: formatDecimal(sliceAmount, MONEY_PLACES),
        units:
          price !== null && price > ZERO
            ? formatDecimal(div(sliceAmount, price), UNIT_PLACES)
            : null,
        executionFxApplied: row.executionFxApplied,
        cappedByShare: item.cappedByShare,
        cappedByNeed: item.cappedByNeed,
        cappedByLimit: item.cappedByLimit,
      };
    });

  return {
    slices,
    allocated: formatDecimal(allocated, MONEY_PLACES),
    remainder: formatDecimal(sub(amount, allocated), MONEY_PLACES),
    unitRoundingRemainder: formatDecimal(unitRoundingRemainder, MONEY_PLACES),
    spreadMode: mode,
    targetCount,
    selectedCount: slices.length,
    relativeSize:
      relativeSize === null ? null : formatDecimal(relativeSize, WEIGHT_PLACES),
    weightImpact: impactText,
  };
}
