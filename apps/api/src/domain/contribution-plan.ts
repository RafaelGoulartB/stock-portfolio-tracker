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
  /** Contribution score in weight units. Only positive values compete. */
  score: string;
  executionPrice: string | null;
  executionFxApplied: boolean;
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
  /** True when the scored-need ceiling bound this slice. */
  cappedByNeed: boolean;
};

export type ContributionSpreadMode = "auto" | "manual" | "all";

export type ContributionPlanResult = {
  slices: ContributionSlice[];
  /** Sum of suggested slice amounts, cents. */
  allocated: string;
  /** `amount - allocated`, cents. Includes need-ceiling leftover. */
  remainder: string;
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

type PlanItem = {
  row: ContributionPlanRow;
  score: Decimal;
  ceiling: Decimal;
  shareCap: Decimal;
  hardCap: Decimal;
  allocated: Decimal;
  cappedByShare: boolean;
  cappedByNeed: boolean;
};

function wholeCount(value: Decimal): bigint {
  return value < ZERO ? 0n : value / UNIT;
}

function rankCandidates(
  rows: readonly ContributionPlanRow[],
): ContributionPlanRow[] {
  return rows
    .filter((row) => toDecimal(row.score) > ZERO)
    .sort((a, b) => {
      const delta = toDecimal(b.score) - toDecimal(a.score);
      if (delta !== 0n) return delta > 0n ? 1 : -1;
      return a.ticker.localeCompare(b.ticker);
    });
}

function emptyResult(
  spreadMode: ContributionSpreadMode,
  targetCount = 0,
  weightImpact: string | null = null,
): ContributionPlanResult {
  return {
    slices: [],
    allocated: formatDecimal(ZERO, MONEY_PLACES),
    remainder: formatDecimal(ZERO, MONEY_PLACES),
    spreadMode,
    targetCount,
    selectedCount: 0,
    relativeSize: null,
    weightImpact,
  };
}

function markCaps(item: PlanItem) {
  if (item.hardCap === item.shareCap && item.shareCap <= item.ceiling) {
    item.cappedByShare = true;
  }
  if (item.hardCap === item.ceiling && item.ceiling <= item.shareCap) {
    item.cappedByNeed = true;
  }
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
 * Auto mode skips names whose scored need is smaller than a meaningful
 * slice of the current book, so a dominant score cannot sprinkle crumbs
 * onto almost-filled names. Manual and "all" keep the ranked list intact.
 */
function inviteCandidates(
  ranked: readonly ContributionPlanRow[],
  targetCount: number,
  mode: ContributionSpreadMode,
  postValue: Decimal,
  minNeed: Decimal,
): ContributionPlanRow[] {
  if (targetCount <= 0 || ranked.length === 0) {
    return [];
  }

  if (mode !== "auto" || minNeed <= ZERO) {
    return ranked.slice(0, targetCount);
  }

  const invited: ContributionPlanRow[] = [];

  for (const row of ranked) {
    if (invited.length >= targetCount) break;

    const ceiling = mul(toDecimal(row.score), postValue);
    if (ceiling < minNeed) continue;

    invited.push(row);
  }

  return invited.length > 0 ? invited : ranked.slice(0, 1);
}

function toItem(
  row: ContributionPlanRow,
  postValue: Decimal,
  shareCap: Decimal,
): PlanItem {
  const score = toDecimal(row.score);
  const ceiling = mul(score, postValue);
  const hardCap = ceiling < shareCap ? ceiling : shareCap;

  return {
    row,
    score,
    ceiling,
    shareCap,
    hardCap,
    allocated: ZERO,
    cappedByShare: false,
    cappedByNeed: false,
  };
}

function distributeCapped(items: PlanItem[], total: Decimal): Decimal {
  let leftover = total;
  let remaining = items.filter((item) => item.hardCap > ZERO);

  while (remaining.length > 0 && leftover > ZERO) {
    const scoreSum = remaining.reduce(
      (sum, item) => add(sum, item.score),
      ZERO,
    );

    if (scoreSum <= ZERO) break;

    const hits: PlanItem[] = [];
    const fits: PlanItem[] = [];

    for (const item of remaining) {
      const room = sub(item.hardCap, item.allocated);
      const proposed = mul(leftover, div(item.score, scoreSum));

      if (proposed > room) hits.push(item);
      else fits.push(item);
    }

    if (hits.length === 0) {
      for (const item of remaining) {
        item.allocated = add(
          item.allocated,
          mul(leftover, div(item.score, scoreSum)),
        );
      }
      leftover = ZERO;
      break;
    }

    for (const item of hits) {
      const room = sub(item.hardCap, item.allocated);
      item.allocated = item.hardCap;
      leftover = sub(leftover, room);
      markCaps(item);
    }

    remaining = fits;
  }

  return leftover;
}

/**
 * Remaining money after the first club is full of scored need flows down
 * the ranked list, one name at a time, up to `maxAssets`.
 */
function waterfallRemainder(
  ranked: readonly ContributionPlanRow[],
  items: PlanItem[],
  leftover: Decimal,
  postValue: Decimal,
  maxShareAmount: Decimal,
  maxAssets: number,
): Decimal {
  const used = new Set(items.map((item) => item.row.ticker));
  let remaining = leftover;

  for (const row of ranked) {
    if (remaining < ONE_CENT) break;
    if (items.length >= maxAssets) break;
    if (used.has(row.ticker)) continue;

    const shareCap = items.length >= 1 ? maxShareAmount : remaining;
    const item = toItem(row, postValue, shareCap);
    if (item.hardCap < ONE_CENT) continue;

    const take = remaining < item.hardCap ? remaining : item.hardCap;
    item.allocated = take;
    remaining = sub(remaining, take);
    if (take === item.hardCap) markCaps(item);
    items.push(item);
    used.add(row.ticker);
  }

  return remaining;
}

/**
 * Splits a contribution across the names the score has already ranked.
 *
 * Amounts are a *suggestion*, never an accounting record: they are rounded
 * to cents at the end and any remainder — rounding dust or money the scored
 * need cannot absorb — is reported instead of silently disappearing. Money
 * that actually moves is entered as a transaction.
 */
export function planContribution(
  input: ContributionPlanInput,
): ContributionPlanResult {
  const config = input.config ?? DEFAULT_CONTRIBUTION_PLAN_CONFIG;
  const amount = toDecimal(input.amount);
  const portfolioValue = toDecimal(input.portfolioValue);
  const ranked = rankCandidates(input.rows);
  const spreadModeGuess: ContributionSpreadMode =
    input.spread === 0
      ? "all"
      : input.spread != null && input.spread > 0
        ? "manual"
        : "auto";

  if (ranked.length === 0 || amount <= ZERO) {
    return emptyResult(spreadModeGuess);
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
  const postValue = add(portfolioValue, amount);
  const minNeed =
    mode === "auto" && portfolioValue > ZERO && weightImpact !== null
      ? mul(portfolioValue, weightImpact)
      : ZERO;
  const invited = inviteCandidates(
    ranked,
    targetCount,
    mode,
    postValue,
    minNeed,
  );

  const impactText =
    weightImpact === null ? null : formatDecimal(weightImpact, WEIGHT_PLACES);

  if (invited.length === 0) {
    return {
      ...emptyResult(mode, targetCount, impactText),
      relativeSize:
        relativeSize === null
          ? null
          : formatDecimal(relativeSize, WEIGHT_PLACES),
    };
  }

  const maxShareAmount = mul(amount, toDecimal(config.maxShare));
  const items: PlanItem[] = invited.map((row) =>
    toItem(row, postValue, invited.length > 1 ? maxShareAmount : amount),
  );

  let leftover = distributeCapped(items, amount);
  leftover = waterfallRemainder(
    ranked,
    items,
    leftover,
    postValue,
    maxShareAmount,
    config.maxAssets,
  );

  let allocated = ZERO;
  const slices: ContributionSlice[] = items
    .filter((item) => item.allocated > ZERO)
    .map((item) => {
      const sliceAmount = toDecimal(
        formatDecimal(item.allocated, MONEY_PLACES),
      );
      allocated = add(allocated, sliceAmount);
      const price =
        item.row.executionPrice === null
          ? null
          : toDecimal(item.row.executionPrice);

      return {
        ticker: item.row.ticker,
        currency: item.row.currency,
        share: formatDecimal(div(sliceAmount, amount), WEIGHT_PLACES),
        amount: formatDecimal(sliceAmount, MONEY_PLACES),
        units:
          price !== null && price > ZERO
            ? formatDecimal(div(sliceAmount, price), UNIT_PLACES)
            : null,
        executionFxApplied: item.row.executionFxApplied,
        cappedByShare: item.cappedByShare,
        cappedByNeed: item.cappedByNeed,
      };
    });

  return {
    slices,
    allocated: formatDecimal(allocated, MONEY_PLACES),
    remainder: formatDecimal(sub(amount, allocated), MONEY_PLACES),
    spreadMode: mode,
    targetCount,
    selectedCount: slices.length,
    relativeSize:
      relativeSize === null ? null : formatDecimal(relativeSize, WEIGHT_PLACES),
    weightImpact: impactText,
  };
}
