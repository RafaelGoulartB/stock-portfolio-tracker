import type {
  Currency,
  GoalScenario,
  GoalTargetKind,
} from "@portifolio-tracker/shared";
import { GOAL_MAX_YEARS } from "@portifolio-tracker/shared";
import {
  add,
  type Decimal,
  div,
  formatDecimal,
  isZero,
  mul,
  sub,
  toDecimal,
  ZERO,
} from "../lib/decimal";
import {
  type ConsolidationInput,
  convertMoney,
  tradeCashTotal,
} from "./positions";

const MONEY_PLACES = 2;
const RATE_PLACES = 6;
const ONE = toDecimal("1");
const TWELVE = toDecimal("12");
const MONTHS_PER_YEAR = 12;
/** Shortest chart, so a goal already in reach still shows a trajectory. */
const MIN_HORIZON_MONTHS = 10 * MONTHS_PER_YEAR;
/** Chart length when the base scenario never reaches the goal. */
const UNREACHED_HORIZON_MONTHS = 30 * MONTHS_PER_YEAR;
const MAX_MONTHS = GOAL_MAX_YEARS * MONTHS_PER_YEAR;

/** `YYYY-MM` of a `YYYY-MM-DD` day. */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** `YYYY-MM` shifted by `count` months. */
export function addMonths(month: string, count: number): string {
  const [year, index] = month.split("-").map(Number);
  const total = year * MONTHS_PER_YEAR + (index - 1) + count;
  const shiftedYear = Math.floor(total / MONTHS_PER_YEAR);
  const shiftedMonth = (total % MONTHS_PER_YEAR) + 1;

  return `${shiftedYear}-${String(shiftedMonth).padStart(2, "0")}`;
}

/** Whole months from `from` to `to`, negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);

  return (toYear - fromYear) * MONTHS_PER_YEAR + (toMonth - fromMonth);
}

// --- Contributions ---------------------------------------------------------

export type ContributionMonth = {
  /** `YYYY-MM`. */
  key: string;
  /** Net new money: buys (with fees) minus sale proceeds. */
  amount: string;
};

export type ContributionYear = { year: number; amount: string };

export type ContributionHistory = {
  displayCurrency: Currency;
  /** Every month from the first trade to the current one, ascending. */
  months: ContributionMonth[];
  years: ContributionYear[];
  /** The last complete months before the current one, up to twelve. */
  recent: {
    months: number;
    total: string;
    /** `null` while no month is complete yet. */
    monthlyAverage: string | null;
    /** Months among them with a positive net contribution. */
    monthsWithContribution: number;
  };
  /** The running month so far. */
  currentMonth: string;
  /** Foreign trades without their own rate, converted at today's rate. */
  approximatedTrades: number;
  /** Foreign trades left out because no rate is known at all. */
  unconvertedTrades: number;
};

export type ContributionHistoryInput = {
  transactions: readonly ConsolidationInput[];
  displayCurrency: Currency;
  /** Today's BRL per USD, the fallback for trades without their own rate. */
  usdBrlRate: string | null;
  /** `YYYY-MM-DD` in the API timezone. */
  today: string;
};

/**
 * New money put into the portfolio per month, derived from the trade log:
 * every buy (with fees) adds, every sale's net proceeds subtract. All asset
 * classes count, fixed income included, because a deposit there is new
 * money too.
 *
 * Without a cash ledger this cannot tell a sale reinvested next month from a
 * withdrawal followed by a new contribution, nor reinvested dividends from
 * fresh money; month totals are honest about trades, not about the bank.
 */
export function contributionHistory(
  input: ContributionHistoryInput,
): ContributionHistory {
  const currentMonth = monthOf(input.today);
  const byMonth = new Map<string, Decimal>();
  let approximatedTrades = 0;
  let unconvertedTrades = 0;
  let firstMonth: string | null = null;

  for (const entry of input.transactions) {
    if (entry.tradedAt > input.today) {
      continue;
    }

    const native = tradeCashTotal(entry);
    let amount: Decimal;

    if (entry.currency === input.displayCurrency) {
      amount = toDecimal(native);
    } else {
      const rate = entry.usdBrlRate ?? input.usdBrlRate;

      if (rate == null) {
        unconvertedTrades += 1;
        continue;
      }

      if (entry.usdBrlRate == null) {
        approximatedTrades += 1;
      }

      amount = toDecimal(
        convertMoney(native, entry.currency, input.displayCurrency, rate),
      );
    }

    const key = monthOf(entry.tradedAt);
    const signed = entry.side === "buy" ? amount : -amount;

    byMonth.set(key, add(byMonth.get(key) ?? ZERO, signed));

    if (firstMonth === null || key < firstMonth) {
      firstMonth = key;
    }
  }

  const months: ContributionMonth[] = [];

  if (firstMonth !== null) {
    const count = Math.max(0, monthsBetween(firstMonth, currentMonth));

    for (let offset = 0; offset <= count; offset += 1) {
      const key = addMonths(firstMonth, offset);

      months.push({
        key,
        amount: formatDecimal(byMonth.get(key) ?? ZERO, MONEY_PLACES),
      });
    }
  }

  const years = new Map<number, Decimal>();

  for (const month of months) {
    const year = Number(month.key.slice(0, 4));

    years.set(year, add(years.get(year) ?? ZERO, toDecimal(month.amount)));
  }

  const complete = months.filter((month) => month.key < currentMonth);
  const recent = complete.slice(-MONTHS_PER_YEAR);
  const recentTotal = recent.reduce(
    (total, month) => add(total, toDecimal(month.amount)),
    ZERO,
  );

  return {
    displayCurrency: input.displayCurrency,
    months,
    years: [...years.entries()]
      .sort(([left], [right]) => left - right)
      .map(([year, amount]) => ({
        year,
        amount: formatDecimal(amount, MONEY_PLACES),
      })),
    recent: {
      months: recent.length,
      total: formatDecimal(recentTotal, MONEY_PLACES),
      monthlyAverage:
        recent.length === 0
          ? null
          : formatDecimal(
              div(recentTotal, toDecimal(String(recent.length))),
              MONEY_PLACES,
            ),
      monthsWithContribution: recent.filter(
        (month) => toDecimal(month.amount) > ZERO,
      ).length,
    },
    currentMonth: formatDecimal(
      byMonth.get(currentMonth) ?? ZERO,
      MONEY_PLACES,
    ),
    approximatedTrades,
    unconvertedTrades,
  };
}

// --- Projection ------------------------------------------------------------

/**
 * Portfolio value the goal asks for. An income goal is the value whose
 * yearly withdrawal at `withdrawalRate` pays twelve months of it.
 */
export function goalTargetValue(
  kind: GoalTargetKind,
  amount: string,
  withdrawalRate: string,
): string {
  if (kind === "value") {
    return formatDecimal(toDecimal(amount), MONEY_PLACES);
  }

  return formatDecimal(
    div(mul(toDecimal(amount), TWELVE), toDecimal(withdrawalRate)),
    MONEY_PLACES,
  );
}

/**
 * Monthly rate equivalent to a yearly one, `(1 + yearly)^(1/12) - 1`. The
 * twelfth root has no exact decimal form, so it is taken on a float and
 * rounded to the ledger's 8 places; over the longest projection the error
 * stays below a millionth of the value.
 */
export function monthlyRate(yearly: string): Decimal {
  const rate = (1 + Number(yearly)) ** (1 / MONTHS_PER_YEAR) - 1;

  return toDecimal(rate.toFixed(8));
}

export type GoalProjectionPoint = {
  /** `YYYY-MM`. */
  month: string;
  value: string;
};

export type GoalScenarioProjection = {
  scenario: GoalScenario;
  /** Real yearly return assumed. */
  annualReturn: string;
  /** Months from now until the goal is reached, `0` if it already is. */
  monthsToTarget: number | null;
  /** `YYYY-MM` the goal is reached, `null` past the longest projection. */
  reachMonth: string | null;
  /** Value at the target month with the planned contribution. */
  valueAtTargetMonth: string | null;
  /** Monthly contribution that reaches the goal exactly at the target month. */
  requiredMonthlyContribution: string | null;
  /** Whether the planned contribution reaches the goal by the target month. */
  onTrack: boolean | null;
  /** Yearly points from now to the horizon. */
  points: GoalProjectionPoint[];
};

export type GoalProjection = {
  targetValue: string;
  /** Monthly income the target value pays at the withdrawal rate. */
  targetMonthlyIncome: string;
  /** Monthly income today's value would pay at the withdrawal rate. */
  sustainableMonthlyIncome: string;
  /** Current value over the target value, not capped at 1. */
  progress: string;
  /** Months from now until the target month, `null` without one. */
  monthsToTargetMonth: number | null;
  horizonMonths: number;
  scenarios: GoalScenarioProjection[];
};

export type GoalProjectionInput = {
  /** Every amount below is in the same currency. */
  currentValue: string;
  monthlyContribution: string;
  targetValue: string;
  withdrawalRate: string;
  scenarios: readonly { scenario: GoalScenario; annualReturn: string }[];
  /** `YYYY-MM`, optional. */
  targetMonth: string | null;
  /** `YYYY-MM` the projection starts from. */
  currentMonth: string;
};

type Simulation = {
  /** Value at the end of each month `0..months`. */
  values: Decimal[];
  monthsToTarget: number | null;
};

/**
 * Month by month: the value grows at the monthly rate, then the month's
 * contribution lands at its end. Decimal all the way, so the projection is
 * exactly reproducible.
 */
function simulate(
  start: Decimal,
  contribution: Decimal,
  rate: Decimal,
  target: Decimal,
  months: number,
): Simulation {
  const growth = add(ONE, rate);
  const values: Decimal[] = [start];
  let monthsToTarget: number | null = start >= target ? 0 : null;
  let value = start;

  for (let month = 1; month <= months; month += 1) {
    value = add(mul(value, growth), contribution);
    values.push(value);

    if (monthsToTarget === null && value >= target) {
      monthsToTarget = month;
    }
  }

  return { values, monthsToTarget };
}

/**
 * Contribution per month that turns `start` into `target` in `months`
 * months at `rate`: `(target - start * g) * rate / (g - 1)` with
 * `g = (1 + rate)^months`, or the straight split at a zero rate. Never
 * negative: a goal growth alone reaches needs nothing more.
 */
function requiredContribution(
  start: Decimal,
  target: Decimal,
  rate: Decimal,
  months: number,
): Decimal {
  let compounded = ONE;

  for (let month = 0; month < months; month += 1) {
    compounded = mul(compounded, add(ONE, rate));
  }

  const gap = sub(target, mul(start, compounded));

  if (gap <= ZERO) {
    return ZERO;
  }

  if (isZero(rate)) {
    return div(gap, toDecimal(String(months)));
  }

  return div(mul(gap, rate), sub(compounded, ONE));
}

/**
 * Where the planned contributions take the portfolio under each real-return
 * scenario, when each reaches the goal, and what it would take to reach it
 * by the target month. Every amount is in today's money because the returns
 * are real.
 */
export function projectGoal(input: GoalProjectionInput): GoalProjection {
  const current = toDecimal(input.currentValue);
  const contribution = toDecimal(input.monthlyContribution);
  const target = toDecimal(input.targetValue);
  const withdrawal = toDecimal(input.withdrawalRate);
  const toTargetMonth =
    input.targetMonth === null
      ? null
      : monthsBetween(input.currentMonth, input.targetMonth);

  const simulations = input.scenarios.map((scenario) => {
    const rate = monthlyRate(scenario.annualReturn);

    return {
      scenario,
      rate,
      run: simulate(current, contribution, rate, target, MAX_MONTHS),
    };
  });

  const base =
    simulations.find((entry) => entry.scenario.scenario === "base") ??
    simulations[0];
  const reach = base?.run.monthsToTarget ?? null;
  const wanted = Math.max(
    MIN_HORIZON_MONTHS,
    reach === null ? UNREACHED_HORIZON_MONTHS : reach,
    toTargetMonth ?? 0,
  );
  // Whole years plus one, so the crossing is visible before the chart ends.
  const horizonMonths = Math.min(
    MAX_MONTHS,
    (Math.ceil(wanted / MONTHS_PER_YEAR) + 1) * MONTHS_PER_YEAR,
  );

  const scenarios = simulations.map(
    ({ scenario, rate, run }): GoalScenarioProjection => {
      const points: GoalProjectionPoint[] = [];

      for (let month = 0; month <= horizonMonths; month += MONTHS_PER_YEAR) {
        points.push({
          month: addMonths(input.currentMonth, month),
          value: formatDecimal(run.values[month], MONEY_PLACES),
        });
      }

      const datedTarget =
        toTargetMonth !== null &&
        toTargetMonth > 0 &&
        toTargetMonth <= MAX_MONTHS;

      return {
        scenario: scenario.scenario,
        annualReturn: formatDecimal(
          toDecimal(scenario.annualReturn),
          RATE_PLACES,
        ),
        monthsToTarget: run.monthsToTarget,
        reachMonth:
          run.monthsToTarget === null
            ? null
            : addMonths(input.currentMonth, run.monthsToTarget),
        valueAtTargetMonth: datedTarget
          ? formatDecimal(run.values[toTargetMonth], MONEY_PLACES)
          : null,
        requiredMonthlyContribution: datedTarget
          ? formatDecimal(
              requiredContribution(current, target, rate, toTargetMonth),
              MONEY_PLACES,
            )
          : null,
        onTrack:
          toTargetMonth === null
            ? null
            : run.monthsToTarget !== null &&
              run.monthsToTarget <= Math.max(0, toTargetMonth),
        points,
      };
    },
  );

  return {
    targetValue: formatDecimal(target, MONEY_PLACES),
    targetMonthlyIncome: formatDecimal(
      div(mul(target, withdrawal), TWELVE),
      MONEY_PLACES,
    ),
    sustainableMonthlyIncome: formatDecimal(
      div(mul(current, withdrawal), TWELVE),
      MONEY_PLACES,
    ),
    progress: formatDecimal(div(current, target), RATE_PLACES),
    monthsToTargetMonth: toTargetMonth,
    horizonMonths,
    scenarios,
  };
}
