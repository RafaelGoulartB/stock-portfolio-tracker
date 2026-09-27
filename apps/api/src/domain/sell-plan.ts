import {
  type AssetClass,
  BR_STOCK_SALE_EXEMPTION_BRL,
  type Currency,
  DEFAULT_SCORE_CONFIG,
  type ScoreConfig,
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
import type { ConsolidationInput } from "./positions";

const MONEY_PLACES = 2;
const WEIGHT_PLACES = 8;
const UNIT = 10n ** BigInt(SCALE);
const ONE = toDecimal("1");

/** Asset classes whose sales count toward the monthly R$ 20 mil exemption. */
export function isExemptEquity(assetClass: AssetClass, currency: Currency) {
  return assetClass === "stock_br" && currency === "BRL";
}

/**
 * Gross BRL sales of exemption-eligible equities in `today`'s calendar month.
 * The exemption is on the month's total sales, so every earlier sale in the
 * month shrinks what is still tax-free.
 */
export function exemptSalesInMonth(
  transactions: readonly ConsolidationInput[],
  today: string,
): string {
  const month = today.slice(0, 7);
  let total = ZERO;

  for (const entry of transactions) {
    if (entry.side !== "sell" || !entry.tradedAt.startsWith(month)) continue;
    if (!isExemptEquity(entry.assetClass, entry.currency)) continue;
    total = add(total, mul(toDecimal(entry.quantity), toDecimal(entry.price)));
  }

  return formatDecimal(total, MONEY_PLACES);
}

export type SellPlanRow = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  /** Units held. */
  quantity: string;
  /** Display-currency market value, `null` without a price. */
  marketValue: string | null;
  currentWeight: string;
  /** Weight a sale brings the asset back to (`ScoreBreakdown.trimTarget`). */
  trimTarget: string | null;
  fairValue: string | null;
  marketPrice: string | null;
  /** True when the market only trades whole units. */
  wholeUnits: boolean;
};

export type SellSuggestion = {
  ticker: string;
  currency: Currency;
  /** Display-currency amount above the band, before the exemption budget. */
  excess: string;
  /** Display-currency amount suggested, rounded to whole units when needed. */
  amount: string;
  units: string;
  weightNow: string;
  weightAfter: string;
  trimTarget: string;
  /** `(fairValue - price) / fairValue`, negative when priced above it. */
  discount: string | null;
};

export type SellPlan = {
  /**
   * Track-record confidence reached the configured bar over a complete
   * track record.
   */
  recommended: boolean;
  confidence: string;
  requiredConfidence: string;
  /** Monthly exemption, soldThisMonth and remaining, all in the display currency. */
  exemptLimit: string | null;
  soldThisMonth: string | null;
  remaining: string | null;
  /** Exempt Brazilian equities, fitted inside the remaining exemption. */
  exempt: SellSuggestion[];
  /** Expensive and past the band, but a sale would be taxed. Information only. */
  taxable: SellSuggestion[];
  total: string;
  /**
   * Exempt excess before fitting it into the exemption. Above `remaining`,
   * every exempt sale was scaled down by the same share.
   */
  exemptExcess: string;
  scaled: boolean;
};

export type SellPlanInput = {
  rows: readonly SellPlanRow[];
  /** Quoted portfolio value in the display currency. */
  portfolioValue: string;
  displayCurrency: Currency;
  /** BRL per 1 USD, needed to express the BRL exemption in USD. */
  usdBrlRate: string | null;
  /** Gross BRL sales of exempt equities already made this month. */
  soldThisMonthBrl: string;
  confidence: string;
  /**
   * True when part of the track record could not be priced: its confidence
   * is not trusted enough to recommend a sale.
   */
  partialTrackRecord?: boolean;
  config?: ScoreConfig;
};

function inDisplay(
  brl: Decimal,
  display: Currency,
  usdBrlRate: string | null,
): Decimal | null {
  if (display === "BRL") return brl;
  if (usdBrlRate === null) return null;
  return div(brl, toDecimal(usdBrlRate));
}

/**
 * Suggests selling part of expensive positions that ran past their target.
 *
 * A row qualifies when its price sits above its fair value and its weight
 * exceeds `trimTarget × (1 + sellBand)`; the suggestion brings it back to
 * the trim target, which never sits below the asset's own valuation tilt.
 * Only Brazilian stocks can use the monthly R$ 20 mil exemption, so they are
 * scaled to fit what is still exempt this month; once it is used up they
 * join everything else as taxable information. Suggestions are marked
 * `recommended` only once a complete valuation track record reaches
 * `sellConfidence`, the bar the simulation needed to make selling pay off.
 */
export function planSales(input: SellPlanInput): SellPlan {
  const config = input.config ?? DEFAULT_SCORE_CONFIG;
  const portfolioValue = toDecimal(input.portfolioValue);
  const band = add(ONE, toDecimal(config.sellBand));
  const limit = inDisplay(
    toDecimal(BR_STOCK_SALE_EXEMPTION_BRL),
    input.displayCurrency,
    input.usdBrlRate,
  );
  const sold = inDisplay(
    toDecimal(input.soldThisMonthBrl),
    input.displayCurrency,
    input.usdBrlRate,
  );
  const remaining =
    limit === null || sold === null
      ? null
      : sub(limit, sold) > ZERO
        ? sub(limit, sold)
        : ZERO;

  type Candidate = { row: SellPlanRow; excess: Decimal; price: Decimal };
  const candidates: Candidate[] = [];

  for (const row of input.rows) {
    if (
      row.marketValue === null ||
      row.trimTarget === null ||
      row.fairValue === null ||
      row.marketPrice === null ||
      // Only assets priced above your own fair value are sale candidates.
      toDecimal(row.marketPrice) <= toDecimal(row.fairValue) ||
      portfolioValue <= ZERO
    ) {
      continue;
    }

    const weight = toDecimal(row.currentWeight);
    const target = toDecimal(row.trimTarget);
    if (weight <= mul(target, band)) continue;

    const value = toDecimal(row.marketValue);
    const quantity = toDecimal(row.quantity);
    if (quantity <= ZERO || value <= ZERO) continue;

    candidates.push({
      row,
      excess: mul(sub(weight, target), portfolioValue),
      price: div(value, quantity),
    });
  }

  // With nothing left of the exemption, any further sale is taxed.
  const exemptionLeft = remaining !== null && remaining > ZERO;
  const exemptCandidates = candidates.filter(
    (item) =>
      exemptionLeft && isExemptEquity(item.row.assetClass, item.row.currency),
  );
  const exemptExcess = exemptCandidates.reduce(
    (sum, item) => add(sum, item.excess),
    ZERO,
  );
  const scale =
    remaining === null
      ? ZERO
      : exemptExcess > remaining && exemptExcess > ZERO
        ? div(remaining, exemptExcess)
        : ONE;

  const suggestion = (item: Candidate, share: Decimal): SellSuggestion => {
    let amount = mul(item.excess, share);
    let units = div(amount, item.price);

    if (item.row.wholeUnits) {
      units = (units / UNIT) * UNIT;
      amount = mul(units, item.price);
    }

    const quantity = toDecimal(item.row.quantity);
    if (units > quantity) {
      units = quantity;
      amount = mul(units, item.price);
    }

    const weightAfter = div(
      sub(toDecimal(item.row.marketValue ?? "0"), amount),
      portfolioValue,
    );
    const fair =
      item.row.fairValue === null ? null : toDecimal(item.row.fairValue);
    const price =
      item.row.marketPrice === null ? null : toDecimal(item.row.marketPrice);

    return {
      ticker: item.row.ticker,
      currency: item.row.currency,
      excess: formatDecimal(item.excess, MONEY_PLACES),
      amount: formatDecimal(amount, MONEY_PLACES),
      units: formatDecimal(units, 4),
      weightNow: item.row.currentWeight,
      weightAfter: formatDecimal(weightAfter, WEIGHT_PLACES),
      trimTarget: item.row.trimTarget ?? "0",
      discount:
        fair !== null && price !== null && fair > ZERO
          ? formatDecimal(div(sub(fair, price), fair), WEIGHT_PLACES)
          : null,
    };
  };

  const byExcess = (a: SellSuggestion, b: SellSuggestion) =>
    Number(b.excess) - Number(a.excess);
  const exempt = exemptCandidates
    .map((item) => suggestion(item, scale))
    .filter((item) => toDecimal(item.amount) > ZERO)
    .sort(byExcess);
  const taxable = candidates
    .filter((item) => !exemptCandidates.includes(item))
    .map((item) => suggestion(item, ONE))
    .sort(byExcess);
  const total = exempt.reduce(
    (sum, item) => add(sum, toDecimal(item.amount)),
    ZERO,
  );
  const confidence = toDecimal(input.confidence);
  const required = toDecimal(config.sellConfidence);
  const money = (value: Decimal | null) =>
    value === null ? null : formatDecimal(value, MONEY_PLACES);

  return {
    recommended: confidence >= required && input.partialTrackRecord !== true,
    confidence: formatDecimal(confidence, WEIGHT_PLACES),
    requiredConfidence: formatDecimal(required, WEIGHT_PLACES),
    exemptLimit: money(limit),
    soldThisMonth: money(sold),
    remaining: money(remaining),
    exempt,
    taxable,
    total: formatDecimal(total, MONEY_PLACES),
    exemptExcess: formatDecimal(exemptExcess, MONEY_PLACES),
    scaled: scale < ONE,
  };
}
