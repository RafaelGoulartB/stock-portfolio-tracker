import {
  type AssetClass,
  BR_STOCK_SALE_EXEMPTION_BRL,
  type Currency,
  DARF_MINIMUM_BRL,
  DAY_TRADE_TAX_RATE,
  FII_TAX_RATE,
  FOREIGN_TAX_RATE,
  type IncomeTaxForeign,
  type IncomeTaxForeignAsset,
  type IncomeTaxHolding,
  type IncomeTaxMonth,
  type IncomeTaxReport,
  type IncomeTaxSale,
  type IncomeTaxWarning,
  ORDINARY_TAX_RATE,
  type TaxKind,
} from "@portifolio-tracker/shared";
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
import type { ConsolidationInput, SplitEvent } from "./positions";

/**
 * Brazilian income tax on buys and sells, recomputed from the ledger. See
 * `tasks/plan-income-tax.md` for the rules and their sources.
 */

/** IRRF printed on one imported broker note. */
export type WithheldTaxEntry = {
  tradeDate: string;
  /** All IRRF of the note, day trade included. */
  withheldTax: string;
  dayTradeWithheldTax: string;
};

/**
 * The broker a note's layout identifies, as the declaration names it. The
 * B3 notes print Inter DTVM's CNPJ; US confirmations name the clearing firm
 * that holds the shares for Inter&Co.
 */
export function brokerOfNoteFormat(format: string): string | null {
  if (format.startsWith("inter-dtvm")) {
    return "Inter DTVM Ltda. (CNPJ 18.945.670/0001-46)";
  }
  if (format === "apex-confirm") return "Inter&Co, custódia Apex Clearing";
  if (format === "drivewealth-confirm") return "Inter&Co, custódia DriveWealth";

  return null;
}

/** A DARF the user recorded as paid. */
export type DarfPayment = { month: string; paidOn: string; amount: string };

/** Opening balances: what was carried into 1 January of `startYear`. */
export type IncomeTaxOpening = {
  startYear: number;
  ordinaryLoss: string;
  dayTradeLoss: string;
  fiiLoss: string;
  foreignLoss: string;
  pendingDarf: string;
  configured: boolean;
};

const UNIT_PATTERN = /^[A-Z0-9]{4}11$/;
const BDR_PATTERN = /^[A-Z0-9]{4}(3[2-5]|39)$/;

const DOMESTIC_KINDS: ReadonlySet<TaxKind> = new Set([
  "stock",
  "unit",
  "etf",
  "bdr",
  "fii",
]);

/** How the law treats the sales of a ticker. */
export function taxKindOf(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency,
): TaxKind {
  if (currency === "USD") {
    return assetClass === "stock_us" ||
      assetClass === "reit" ||
      assetClass === "etf"
      ? "foreign"
      : "uncovered";
  }

  switch (assetClass) {
    case "stock_br":
      if (UNIT_PATTERN.test(ticker)) return "unit";
      if (BDR_PATTERN.test(ticker)) return "bdr";
      return "stock";
    case "etf":
      return "etf";
    case "bdr":
      return "bdr";
    case "reit":
      return "fii";
    default:
      return "uncovered";
  }
}

/** Suggested IRPF "Bens e Direitos" group and code, when unambiguous. */
function holdingCode(
  kind: TaxKind,
  assetClass: AssetClass,
): { group: string | null; code: string | null } {
  if (kind === "stock" || kind === "unit") return { group: "03", code: "01" };
  if (kind === "fii") return { group: "07", code: "03" };
  if (kind === "foreign" && assetClass !== "etf") {
    return { group: "03", code: "01" };
  }

  return { group: null, code: null };
}

const MONTH_COUNT = 12;

/** Rounds to cents, half away from zero, as a DARF does. */
function cents(value: Decimal): Decimal {
  return toDecimal(formatDecimal(value, 2));
}

function money(value: Decimal): string {
  return formatDecimal(value, 2);
}

function minDecimal(a: Decimal, b: Decimal): Decimal {
  return a < b ? a : b;
}

/** `part / whole` of `amount`, exact when the part is the whole. */
function portion(amount: Decimal, part: Decimal, whole: Decimal): Decimal {
  if (part === whole) return amount;
  if (isZero(whole)) return ZERO;

  return div(mul(amount, part), whole);
}

type Holding = {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  kind: TaxKind;
  quantity: Decimal;
  /** Acquisition cost held in the native currency, fees included. */
  costNative: Decimal;
  /** The same cost in BRL (each buy at its own rate for USD assets). */
  costBrl: Decimal;
  /** A USD buy still held has no trade-date rate: BRL cost is unknown. */
  brlUnknown: boolean;
};

type Snapshot = Map<
  string,
  {
    quantity: Decimal;
    costNative: Decimal;
    costBrl: Decimal;
    brlUnknown: boolean;
    assetClass: AssetClass;
    currency: Currency;
    kind: TaxKind;
  }
>;

/** A sale as the assessment sees it. */
type SaleEvent = {
  ticker: string;
  kind: TaxKind;
  tradedAt: string;
  dayTrade: boolean;
  quantity: Decimal;
  /** Gross sale value in the native currency (quantity × price). */
  grossNative: Decimal;
  /** Result in BRL; `null` when a USD rate is missing. */
  resultBrl: Decimal | null;
  /** Foreign assets only. */
  proceedsBrl: Decimal | null;
  costBrl: Decimal | null;
};

/** The part of a trade a day-trade pairing consumed or left over. */
type Slice = { entry: ConsolidationInput; quantity: Decimal };

/**
 * Units as traded that day. The tax ledger applies splits as dated events,
 * so year-end quantities are the ones actually held then.
 */
function units(entry: ConsolidationInput): Decimal {
  return toDecimal(entry.quantity);
}

function gross(entry: ConsolidationInput): Decimal {
  return mul(toDecimal(entry.quantity), toDecimal(entry.price));
}

/** Cash of a slice: `gross ± fees`, in proportion to the units taken. */
function sliceCash(slice: Slice): { gross: Decimal; net: Decimal } {
  const total = units(slice.entry);
  const tradeGross = gross(slice.entry);
  const fees = toDecimal(slice.entry.fees);
  const cash =
    slice.entry.side === "buy" ? add(tradeGross, fees) : sub(tradeGross, fees);

  return {
    gross: portion(tradeGross, slice.quantity, total),
    net: portion(cash, slice.quantity, total),
  };
}

function rateOf(entry: ConsolidationInput): Decimal | null {
  if (entry.usdBrlRate == null) return null;
  const rate = toDecimal(entry.usdBrlRate);

  return rate > ZERO ? rate : null;
}

function addToHolding(holding: Holding, slice: Slice): void {
  const { net } = sliceCash(slice);

  holding.quantity = add(holding.quantity, slice.quantity);
  holding.costNative = add(holding.costNative, net);

  if (holding.currency === "BRL") {
    holding.costBrl = add(holding.costBrl, net);
    return;
  }

  const rate = rateOf(slice.entry);
  if (rate === null) {
    holding.brlUnknown = true;
  } else {
    holding.costBrl = add(holding.costBrl, mul(net, rate));
  }
}

/** Sells a slice at the moving average cost; returns the sale. */
function sellFromHolding(
  holding: Holding,
  slice: Slice,
  missingRates: Set<string>,
): SaleEvent {
  const { gross: grossNative, net } = sliceCash(slice);
  const sold =
    holding.quantity < slice.quantity ? holding.quantity : slice.quantity;
  const releasedNative = portion(holding.costNative, sold, holding.quantity);
  const releasedBrl = portion(holding.costBrl, sold, holding.quantity);
  let resultBrl: Decimal | null;
  let proceedsBrl: Decimal | null = null;
  let costBrl: Decimal | null = null;

  if (holding.currency === "BRL") {
    resultBrl = sub(net, releasedBrl);
  } else {
    const rate = rateOf(slice.entry);
    if (rate === null) missingRates.add(holding.ticker);

    if (rate === null || holding.brlUnknown) {
      resultBrl = null;
    } else {
      proceedsBrl = mul(net, rate);
      costBrl = releasedBrl;
      resultBrl = sub(proceedsBrl, releasedBrl);
    }
  }

  holding.quantity = sub(holding.quantity, slice.quantity);
  holding.costNative = sub(holding.costNative, releasedNative);
  holding.costBrl = sub(holding.costBrl, releasedBrl);

  if (holding.quantity <= ZERO) {
    holding.quantity = ZERO;
    holding.costNative = ZERO;
    holding.costBrl = ZERO;
    holding.brlUnknown = false;
  }

  return {
    ticker: holding.ticker,
    kind: holding.kind,
    tradedAt: slice.entry.tradedAt,
    dayTrade: false,
    quantity: slice.quantity,
    grossNative,
    resultBrl,
    proceedsBrl,
    costBrl,
  };
}

/**
 * Pairs a day's buys and sells of one B3 ticker, first buy with first sell
 * (IN RFB 1.585/2015). The paired units are a day trade and never touch the
 * position held before; the rest of the day is ordinary.
 */
function pairDayTrades(day: readonly ConsolidationInput[]): {
  pairedBuys: Slice[];
  pairedSells: Slice[];
  restBuys: Slice[];
  restSells: Slice[];
} {
  const take = (side: "buy" | "sell", limit: Decimal) => {
    const paired: Slice[] = [];
    const rest: Slice[] = [];
    let left = limit;

    for (const entry of day.filter((trade) => trade.side === side)) {
      const quantity = units(entry);
      const used = minDecimal(left, quantity);

      if (used > ZERO) paired.push({ entry, quantity: used });
      if (quantity > used) rest.push({ entry, quantity: sub(quantity, used) });
      left = sub(left, used);
    }

    return { paired, rest };
  };
  const total = (side: "buy" | "sell") =>
    day
      .filter((trade) => trade.side === side)
      .reduce((sum, trade) => add(sum, units(trade)), ZERO);
  const matched = minDecimal(total("buy"), total("sell"));
  const buys = take("buy", matched);
  const sells = take("sell", matched);

  return {
    pairedBuys: buys.paired,
    pairedSells: sells.paired,
    restBuys: buys.rest,
    restSells: sells.rest,
  };
}

function snapshotOf(holdings: Map<string, Holding>): Snapshot {
  const snapshot: Snapshot = new Map();

  for (const [ticker, holding] of holdings) {
    if (holding.quantity > ZERO) {
      snapshot.set(ticker, {
        quantity: holding.quantity,
        costNative: holding.costNative,
        costBrl: holding.costBrl,
        brlUnknown: holding.brlUnknown,
        assetClass: holding.assetClass,
        currency: holding.currency,
        kind: holding.kind,
      });
    }
  }

  return snapshot;
}

function chronological(a: ConsolidationInput, b: ConsolidationInput): number {
  if (a.tradedAt !== b.tradedAt) return a.tradedAt < b.tradedAt ? -1 : 1;

  return a.createdAt.getTime() - b.createdAt.getTime();
}

type LedgerRun = {
  sales: SaleEvent[];
  /** Holdings on 31 December of each requested year. */
  snapshots: Map<number, Snapshot>;
  /** Tickers whose USD trades lack a trade-date rate, by year of the trade. */
  missingRatesByYear: Map<number, Set<string>>;
  kinds: Map<string, TaxKind>;
  /** Bonus shares credited, with the cost they added. */
  bonuses: BonusEvent[];
};

type BonusEvent = {
  ticker: string;
  effectiveAt: string;
  quantity: Decimal;
  unitCost: Decimal;
  value: Decimal;
};

/**
 * Replays the ledger in trade order, with trades in the units they were
 * traded in (not `adjustForSplits`) and splits applied on their dates.
 */
function runLedger(
  trades: readonly ConsolidationInput[],
  splits: readonly SplitEvent[],
  snapshotYears: readonly number[],
): LedgerRun {
  const ordered = [...trades].sort(chronological);
  const pendingSplits = [...splits].sort((a, b) =>
    a.effectiveAt.localeCompare(b.effectiveAt),
  );
  // A ticker keeps the class of its latest trade, as on the positions screens.
  const latest = new Map<string, ConsolidationInput>();
  for (const trade of ordered) latest.set(trade.ticker, trade);
  const kinds = new Map<string, TaxKind>();
  for (const [ticker, trade] of latest) {
    kinds.set(ticker, taxKindOf(ticker, trade.assetClass, trade.currency));
  }

  const holdings = new Map<string, Holding>();
  const sales: SaleEvent[] = [];
  const snapshots = new Map<number, Snapshot>();
  const missingRatesByYear = new Map<number, Set<string>>();
  const pendingSnapshots = [...new Set(snapshotYears)].sort((a, b) => a - b);

  const bonuses: BonusEvent[] = [];

  /**
   * Applies every split and bonus effective on or before `day`. A split
   * never moves cost; bonus shares add the cost the company attributed to
   * them, which is also exempt income.
   */
  const advanceTo = (day: string) => {
    while (
      pendingSplits.length > 0 &&
      (pendingSplits[0] as SplitEvent).effectiveAt <= day
    ) {
      const split = pendingSplits.shift() as SplitEvent;
      const holding = holdings.get(split.ticker);

      if (!holding || holding.quantity <= ZERO) continue;

      const before = holding.quantity;
      holding.quantity = div(
        mul(before, toDecimal(split.toQuantity)),
        toDecimal(split.fromQuantity),
      );

      if (split.kind === "bonus" && split.unitCost != null) {
        const unitCost = toDecimal(split.unitCost);
        const received = sub(holding.quantity, before);
        const value = mul(received, unitCost);

        holding.costNative = add(holding.costNative, value);
        if (holding.currency === "BRL") {
          holding.costBrl = add(holding.costBrl, value);
        } else {
          // A foreign bonus cost has no trade-date rate to convert it.
          holding.brlUnknown = true;
        }
        bonuses.push({
          ticker: split.ticker,
          effectiveAt: split.effectiveAt,
          quantity: received,
          unitCost,
          value,
        });
      }
    }
  };
  const takeSnapshotsBefore = (year: number) => {
    while (
      pendingSnapshots.length > 0 &&
      (pendingSnapshots[0] as number) < year
    ) {
      const snapshotYear = pendingSnapshots.shift() as number;
      advanceTo(`${snapshotYear}-12-31`);
      snapshots.set(snapshotYear, snapshotOf(holdings));
    }
  };

  const holdingFor = (trade: ConsolidationInput): Holding => {
    const last = latest.get(trade.ticker) as ConsolidationInput;
    let holding = holdings.get(trade.ticker);

    if (!holding) {
      holding = {
        ticker: trade.ticker,
        assetClass: last.assetClass,
        currency: last.currency,
        kind: kinds.get(trade.ticker) as TaxKind,
        quantity: ZERO,
        costNative: ZERO,
        costBrl: ZERO,
        brlUnknown: false,
      };
      holdings.set(trade.ticker, holding);
    }

    return holding;
  };

  // Group consecutive trades of the same day and ticker.
  const groups: ConsolidationInput[][] = [];
  const byKey = new Map<string, ConsolidationInput[]>();
  for (const trade of ordered) {
    const key = `${trade.tradedAt}|${trade.ticker}`;
    let group = byKey.get(key);
    if (!group) {
      group = [];
      byKey.set(key, group);
      groups.push(group);
    }
    group.push(trade);
  }

  for (const day of groups) {
    const first = day[0] as ConsolidationInput;
    const year = Number(first.tradedAt.slice(0, 4));

    takeSnapshotsBefore(year);
    advanceTo(first.tradedAt);

    const holding = holdingFor(first);
    const missing = missingRatesByYear.get(year) ?? new Set<string>();
    missingRatesByYear.set(year, missing);

    if (holding.currency === "USD") {
      for (const trade of day) {
        if (rateOf(trade) === null) missing.add(trade.ticker);
      }
    }

    if (!DOMESTIC_KINDS.has(holding.kind)) {
      for (const trade of day) {
        const slice = { entry: trade, quantity: units(trade) };
        if (trade.side === "buy") addToHolding(holding, slice);
        else sales.push(sellFromHolding(holding, slice, missing));
      }
      continue;
    }

    const { pairedBuys, pairedSells, restBuys, restSells } = pairDayTrades(day);

    if (pairedSells.length > 0) {
      const cost = pairedBuys.reduce(
        (sum, slice) => add(sum, sliceCash(slice).net),
        ZERO,
      );
      const proceeds = pairedSells.reduce(
        (sum, slice) => add(sum, sliceCash(slice).net),
        ZERO,
      );
      sales.push({
        ticker: holding.ticker,
        kind: holding.kind,
        tradedAt: first.tradedAt,
        dayTrade: true,
        quantity: pairedSells.reduce(
          (sum, slice) => add(sum, slice.quantity),
          ZERO,
        ),
        grossNative: pairedSells.reduce(
          (sum, slice) => add(sum, sliceCash(slice).gross),
          ZERO,
        ),
        resultBrl: sub(proceeds, cost),
        proceedsBrl: null,
        costBrl: null,
      });
    }

    // Only one side can have units left over after pairing.
    for (const slice of restBuys) addToHolding(holding, slice);
    for (const slice of restSells) {
      sales.push(sellFromHolding(holding, slice, missing));
    }
  }

  takeSnapshotsBefore(Number.POSITIVE_INFINITY);

  return { sales, snapshots, missingRatesByYear, kinds, bonuses };
}

/** Consumes a loss pool with a month's (or year's) result. */
function settle(
  result: Decimal,
  pool: Decimal,
): { base: Decimal; pool: Decimal } {
  if (result <= ZERO) return { base: ZERO, pool: sub(pool, result) };

  const used = minDecimal(pool, result);

  return { base: sub(result, used), pool: sub(pool, used) };
}

function monthOf(day: string): string {
  return day.slice(0, 7);
}

function monthsOfYear(year: number): string[] {
  return Array.from(
    { length: MONTH_COUNT },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
  );
}

type MonthState = {
  ordinaryLoss: Decimal;
  dayTradeLoss: Decimal;
  fiiLoss: Decimal;
  withheldCarry: Decimal;
  pendingDarf: Decimal;
};

function assessMonth(
  month: string,
  sales: readonly SaleEvent[],
  withheld: { swing: Decimal; dayTrade: Decimal },
  state: MonthState,
  payment: DarfPayment | undefined,
): IncomeTaxMonth {
  let stockSales = ZERO;
  let stockResult = ZERO;
  let otherOrdinary = ZERO;
  let dayTradeResult = ZERO;
  let fiiResult = ZERO;

  for (const sale of sales) {
    const result = sale.resultBrl ?? ZERO;

    if (sale.kind === "fii") {
      fiiResult = add(fiiResult, result);
    } else if (sale.dayTrade) {
      dayTradeResult = add(dayTradeResult, result);
    } else if (sale.kind === "stock") {
      stockSales = add(stockSales, sale.grossNative);
      stockResult = add(stockResult, result);
    } else {
      otherOrdinary = add(otherOrdinary, result);
    }
  }

  const exempt =
    stockSales > ZERO && stockSales <= toDecimal(BR_STOCK_SALE_EXEMPTION_BRL);
  // An exempt month's stock gain is exempt income; its loss still offsets.
  const exemptGain = exempt && stockResult > ZERO ? stockResult : ZERO;
  const ordinaryResult = add(
    otherOrdinary,
    exempt ? (stockResult < ZERO ? stockResult : ZERO) : stockResult,
  );

  const ordinary = settle(ordinaryResult, state.ordinaryLoss);
  const dayTrade = settle(dayTradeResult, state.dayTradeLoss);
  const fii = settle(fiiResult, state.fiiLoss);
  const ordinaryTax = cents(mul(ordinary.base, toDecimal(ORDINARY_TAX_RATE)));
  const dayTradeTax = cents(mul(dayTrade.base, toDecimal(DAY_TRADE_TAX_RATE)));
  const fiiTax = cents(mul(fii.base, toDecimal(FII_TAX_RATE)));
  const taxDue = add(add(ordinaryTax, dayTradeTax), fiiTax);

  const available = add(
    state.withheldCarry,
    add(withheld.swing, withheld.dayTrade),
  );
  const withheldUsed = minDecimal(available, taxDue);
  const pendingBefore = state.pendingDarf;
  const payable = add(sub(taxDue, withheldUsed), pendingBefore);
  const darf = payable >= toDecimal(DARF_MINIMUM_BRL) ? payable : ZERO;

  state.ordinaryLoss = ordinary.pool;
  state.dayTradeLoss = dayTrade.pool;
  state.fiiLoss = fii.pool;
  state.withheldCarry = sub(available, withheldUsed);
  state.pendingDarf = sub(payable, darf);

  return {
    month,
    stockSales: money(stockSales),
    exempt,
    exemptGain: money(exemptGain),
    ordinaryResult: money(ordinaryResult),
    dayTradeResult: money(dayTradeResult),
    fiiResult: money(fiiResult),
    ordinaryLoss: money(state.ordinaryLoss),
    dayTradeLoss: money(state.dayTradeLoss),
    fiiLoss: money(state.fiiLoss),
    ordinaryBase: money(ordinary.base),
    dayTradeBase: money(dayTrade.base),
    fiiBase: money(fii.base),
    ordinaryTax: money(ordinaryTax),
    dayTradeTax: money(dayTradeTax),
    fiiTax: money(fiiTax),
    taxDue: money(taxDue),
    withheld: money(withheld.swing),
    withheldDayTrade: money(withheld.dayTrade),
    withheldUsed: money(withheldUsed),
    withheldCarry: money(state.withheldCarry),
    pendingBefore: money(pendingBefore),
    darf: money(darf),
    pendingAfter: money(state.pendingDarf),
    darfPaid: payment ? money(toDecimal(payment.amount)) : null,
    darfPaidOn: payment?.paidOn ?? null,
    sales: sales.length,
  };
}

function withheldByMonth(
  entries: readonly WithheldTaxEntry[],
): Map<string, { swing: Decimal; dayTrade: Decimal }> {
  const byMonth = new Map<string, { swing: Decimal; dayTrade: Decimal }>();

  for (const entry of entries) {
    const key = monthOf(entry.tradeDate);
    const current = byMonth.get(key) ?? { swing: ZERO, dayTrade: ZERO };
    const total = toDecimal(entry.withheldTax);
    const dayTrade = toDecimal(entry.dayTradeWithheldTax);

    current.swing = add(current.swing, sub(total, dayTrade));
    current.dayTrade = add(current.dayTrade, dayTrade);
    byMonth.set(key, current);
  }

  return byMonth;
}

function foreignYear(
  sales: readonly SaleEvent[],
  lossBefore: Decimal | null,
  missingRates: readonly string[],
): { report: IncomeTaxForeign; lossAfter: Decimal | null } {
  const byTicker = new Map<string, SaleEvent[]>();

  for (const sale of sales) {
    const list = byTicker.get(sale.ticker) ?? [];
    list.push(sale);
    byTicker.set(sale.ticker, list);
  }

  let complete = true;
  let net = ZERO;
  const assets: IncomeTaxForeignAsset[] = [...byTicker.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ticker, list]) => {
      const known = list.every((sale) => sale.resultBrl !== null);
      const sum = (pick: (sale: SaleEvent) => Decimal | null) =>
        list.reduce((total, sale) => add(total, pick(sale) ?? ZERO), ZERO);

      if (!known) complete = false;
      else
        net = add(
          net,
          sum((sale) => sale.resultBrl),
        );

      return {
        ticker,
        sales: list.length,
        proceedsUsd: money(sum((sale) => sale.grossNative)),
        proceedsBrl: known ? money(sum((sale) => sale.proceedsBrl)) : null,
        costBrl: known ? money(sum((sale) => sale.costBrl)) : null,
        resultBrl: known ? money(sum((sale) => sale.resultBrl)) : null,
      };
    });

  if (!complete || lossBefore === null) {
    return {
      report: {
        assets,
        netResult: complete ? money(net) : null,
        lossBefore: money(lossBefore ?? ZERO),
        lossAfter: null,
        base: null,
        estimatedTax: null,
        missingRates: [...missingRates],
      },
      lossAfter: null,
    };
  }

  const settled = settle(net, lossBefore);

  return {
    report: {
      assets,
      netResult: money(net),
      lossBefore: money(lossBefore),
      lossAfter: money(settled.pool),
      base: money(settled.base),
      estimatedTax: money(
        cents(mul(settled.base, toDecimal(FOREIGN_TAX_RATE))),
      ),
      missingRates: [...missingRates],
    },
    lossAfter: settled.pool,
  };
}

function toSale(sale: SaleEvent): IncomeTaxSale {
  return {
    ticker: sale.ticker,
    kind: sale.kind,
    tradedAt: sale.tradedAt,
    dayTrade: sale.dayTrade,
    quantity: formatDecimal(sale.quantity, 8),
    grossNative: money(sale.grossNative),
    resultBrl: sale.resultBrl === null ? null : money(sale.resultBrl),
  };
}

function holdingsOf(
  before: Snapshot,
  after: Snapshot,
  kinds: Map<string, TaxKind>,
): IncomeTaxHolding[] {
  const tickers = [...new Set([...before.keys(), ...after.keys()])]
    .filter((ticker) => kinds.get(ticker) !== "uncovered")
    .sort((a, b) => a.localeCompare(b));

  return tickers.map((ticker) => {
    const previous = before.get(ticker);
    const current = after.get(ticker);
    const reference = (current ?? previous) as NonNullable<typeof current>;
    const { group, code } = holdingCode(reference.kind, reference.assetClass);
    const costBrl = (entry: typeof current) =>
      entry === undefined
        ? "0.00"
        : entry.brlUnknown
          ? null
          : money(entry.costBrl);

    return {
      ticker,
      kind: reference.kind,
      currency: reference.currency,
      group,
      code,
      quantityBefore: formatDecimal(previous?.quantity ?? ZERO, 8),
      quantity: formatDecimal(current?.quantity ?? ZERO, 8),
      costBefore: costBrl(previous),
      cost: costBrl(current),
      costUsd:
        reference.currency === "USD"
          ? money(current?.costNative ?? ZERO)
          : null,
      averagePrice:
        current && current.quantity > ZERO
          ? formatDecimal(div(current.costNative, current.quantity), 4)
          : null,
      // Declaration facts are joined by the API from the user's records.
      legalName: null,
      cnpj: null,
      broker: null,
    };
  });
}

/**
 * The yearly report: monthly B3 assessment, foreign results, and year-end
 * holdings. `trades` is the account's whole ledger as traded, unadjusted.
 */
export function buildIncomeTaxReport(input: {
  year: number;
  trades: readonly ConsolidationInput[];
  splits: readonly SplitEvent[];
  withheld: readonly WithheldTaxEntry[];
  opening: IncomeTaxOpening;
  payments?: readonly DarfPayment[];
}): IncomeTaxReport {
  const { year, trades, opening } = input;
  const run = runLedger(trades, input.splits, [year - 1, year]);
  const assessed = year >= opening.startYear;
  const withheld = withheldByMonth(input.withheld);
  const payments = new Map(
    (input.payments ?? []).map((payment) => [payment.month, payment]),
  );
  const salesByMonth = new Map<string, SaleEvent[]>();
  const foreignByYear = new Map<number, SaleEvent[]>();

  for (const sale of run.sales) {
    if (sale.kind === "uncovered") continue;

    if (sale.kind === "foreign") {
      const saleYear = Number(sale.tradedAt.slice(0, 4));
      const list = foreignByYear.get(saleYear) ?? [];
      list.push(sale);
      foreignByYear.set(saleYear, list);
      continue;
    }

    const key = monthOf(sale.tradedAt);
    const list = salesByMonth.get(key) ?? [];
    list.push(sale);
    salesByMonth.set(key, list);
  }

  const state: MonthState = {
    ordinaryLoss: toDecimal(opening.ordinaryLoss),
    dayTradeLoss: toDecimal(opening.dayTradeLoss),
    fiiLoss: toDecimal(opening.fiiLoss),
    withheldCarry: ZERO,
    pendingDarf: toDecimal(opening.pendingDarf),
  };
  let months: IncomeTaxMonth[] = [];
  let foreignLoss: Decimal | null = toDecimal(opening.foreignLoss);
  let foreign: IncomeTaxForeign = {
    assets: [],
    netResult: null,
    lossBefore: money(foreignLoss),
    lossAfter: null,
    base: null,
    estimatedTax: null,
    missingRates: [],
  };

  if (assessed) {
    for (let current = opening.startYear; current <= year; current += 1) {
      // IRRF left at year end goes to the yearly declaration, not forward.
      state.withheldCarry = ZERO;
      const assessedMonths = monthsOfYear(current).map((month) =>
        assessMonth(
          month,
          salesByMonth.get(month) ?? [],
          withheld.get(month) ?? { swing: ZERO, dayTrade: ZERO },
          state,
          payments.get(month),
        ),
      );
      const missing = [
        ...(run.missingRatesByYear.get(current) ?? new Set<string>()),
      ]
        .filter((ticker) => run.kinds.get(ticker) === "foreign")
        .sort();
      const result = foreignYear(
        foreignByYear.get(current) ?? [],
        foreignLoss,
        missing,
      );

      foreignLoss = result.lossAfter;

      if (current === year) {
        months = assessedMonths;
        foreign = result.report;
      }
    }
  }

  const yearSales = run.sales
    .filter(
      (sale) =>
        sale.kind !== "uncovered" && sale.tradedAt.startsWith(`${year}-`),
    )
    .map(toSale);
  const sum = (pick: (month: IncomeTaxMonth) => string) =>
    money(
      months.reduce((total, month) => add(total, toDecimal(pick(month))), ZERO),
    );
  const last = months.at(-1);
  const warnings: IncomeTaxWarning[] = [];

  if (!opening.configured) warnings.push({ code: "not_configured" });
  if (!assessed) {
    warnings.push({ code: "before_start", startYear: opening.startYear });
  }

  const missingRates = [
    ...(run.missingRatesByYear.get(year) ?? new Set<string>()),
  ].sort();
  if (missingRates.length > 0) {
    warnings.push({ code: "missing_rates", tickers: missingRates });
  }

  const uncovered = [
    ...new Set(
      run.sales
        .filter(
          (sale) =>
            sale.kind === "uncovered" && sale.tradedAt.startsWith(`${year}-`),
        )
        .map((sale) => sale.ticker),
    ),
  ].sort();
  if (uncovered.length > 0) {
    warnings.push({ code: "uncovered_sales", tickers: uncovered });
  }

  const units = [...run.kinds.entries()]
    .filter(([, kind]) => kind === "unit")
    .map(([ticker]) => ticker)
    .sort();
  if (units.length > 0)
    warnings.push({ code: "units_assumed", tickers: units });

  const dayTrades = yearSales.filter((sale) => sale.dayTrade).length;
  if (dayTrades > 0) warnings.push({ code: "day_trades", count: dayTrades });

  const years = [
    ...new Set(trades.map((trade) => Number(trade.tradedAt.slice(0, 4)))),
  ].sort((a, b) => a - b);

  return {
    year,
    startYear: opening.startYear,
    assessed,
    months,
    totals: {
      exemptGain: sum((month) => month.exemptGain),
      taxDue: sum((month) => month.taxDue),
      darf: sum((month) => month.darf),
      darfPaid: sum((month) => month.darfPaid ?? "0"),
      withheld: sum((month) => month.withheld),
      withheldDayTrade: sum((month) => month.withheldDayTrade),
      withheldLeft: last?.withheldCarry ?? "0.00",
      ordinaryLoss:
        last?.ordinaryLoss ?? money(toDecimal(opening.ordinaryLoss)),
      dayTradeLoss:
        last?.dayTradeLoss ?? money(toDecimal(opening.dayTradeLoss)),
      fiiLoss: last?.fiiLoss ?? money(toDecimal(opening.fiiLoss)),
      pendingDarf: last?.pendingAfter ?? money(toDecimal(opening.pendingDarf)),
    },
    sales: yearSales,
    foreign,
    holdings: holdingsOf(
      run.snapshots.get(year - 1) ?? new Map(),
      run.snapshots.get(year) ?? new Map(),
      run.kinds,
    ),
    bonuses: run.bonuses
      .filter((bonus) => bonus.effectiveAt.startsWith(`${year}-`))
      .map((bonus) => ({
        ticker: bonus.ticker,
        effectiveAt: bonus.effectiveAt,
        quantity: formatDecimal(bonus.quantity, 8),
        unitCost: formatDecimal(bonus.unitCost, 8),
        value: money(bonus.value),
        legalName: null,
        cnpj: null,
      })),
    // Joined by the API from the user's records.
    foreignCash: { before: null, after: null },
    warnings,
    years,
  };
}

/** Defaults shown before the user saves opening balances. */
export function defaultOpening(
  trades: readonly { tradedAt: string }[],
  currentYear: number,
): IncomeTaxOpening {
  const first = trades.reduce<string | null>(
    (min, trade) =>
      min === null || trade.tradedAt < min ? trade.tradedAt : min,
    null,
  );

  return {
    startYear: first ? Number(first.slice(0, 4)) : currentYear,
    ordinaryLoss: "0",
    dayTradeLoss: "0",
    fiiLoss: "0",
    foreignLoss: "0",
    pendingDarf: "0",
    configured: false,
  };
}
