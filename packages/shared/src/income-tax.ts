import { z } from "zod";
import { normalizeCnpj } from "./cnpj";
import { isoDate, nonNegativeDecimal, positiveDecimal } from "./decimal";
import { tickerSchema } from "./transactions";

/**
 * Brazilian income tax on buys and sells (IRPF). Rates and thresholds are
 * law, not preferences: change them only when the law changes. See
 * `tasks/plan-income-tax.md`.
 */

/** Ordinary B3 operations: stocks, units, ETFs, BDRs (IN RFB 1.585/2015). */
export const ORDINARY_TAX_RATE = "0.15";
/** Day trades on B3. */
export const DAY_TRADE_TAX_RATE = "0.20";
/** Real estate fund (FII) quotas, ordinary or day trade. */
export const FII_TAX_RATE = "0.20";
/** Foreign financial applications, yearly (Lei 14.754/2023). */
export const FOREIGN_TAX_RATE = "0.15";
/** A DARF below this amount is not paid; it is added to the next month. */
export const DARF_MINIMUM_BRL = "10";

/** How the tax law treats a ticker's sales. */
export const TAX_KINDS = [
  "stock",
  "unit",
  "etf",
  "bdr",
  "fii",
  "foreign",
  "uncovered",
] as const;
export type TaxKind = (typeof TAX_KINDS)[number];

/** Oldest year the assessment can start from. */
export const INCOME_TAX_MIN_YEAR = 2000;

export const incomeTaxYearSchema = z
  .number()
  .int()
  .min(INCOME_TAX_MIN_YEAR)
  .max(2100);

/**
 * Balances carried into `startYear`: what was left on 31 December of the
 * year before, as declared. Assessment starts on 1 January of `startYear`.
 */
export const incomeTaxSettingsInput = z.object({
  startYear: incomeTaxYearSchema,
  ordinaryLoss: nonNegativeDecimal,
  dayTradeLoss: nonNegativeDecimal,
  fiiLoss: nonNegativeDecimal,
  foreignLoss: nonNegativeDecimal,
  /** Tax already assessed but below the DARF minimum, not paid yet. */
  pendingDarf: nonNegativeDecimal,
});

export type IncomeTaxSettingsInput = z.infer<typeof incomeTaxSettingsInput>;

export type IncomeTaxSettings = IncomeTaxSettingsInput & {
  /** False until the user saves opening balances; defaults are shown. */
  configured: boolean;
};

export const incomeTaxReportInput = z.object({
  year: incomeTaxYearSchema,
});

const monthKey = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the YYYY-MM format");

/** A DARF (code 6015) the user paid for one assessed month. */
export const darfPaymentInput = z.object({
  month: monthKey,
  paidOn: isoDate,
  amount: positiveDecimal,
});

export type DarfPaymentInput = z.infer<typeof darfPaymentInput>;

export const removeDarfPaymentInput = z.object({ month: monthKey });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .optional()
    .transform((value) => (value ? value : null));

/**
 * What the declaration needs about a holding that the ledger cannot know:
 * the issuer's legal name and CNPJ, and the broker when no imported note
 * names it. Empty fields clear the stored value.
 */
export const assetTaxProfileInput = z.object({
  ticker: tickerSchema,
  legalName: optionalText(160),
  cnpj: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return null;
      const normalized = normalizeCnpj(value);
      if (normalized === null) {
        ctx.addIssue({ code: "custom", message: "Invalid CNPJ" });
        return z.NEVER;
      }
      return normalized;
    }),
  broker: optionalText(160),
});

export type AssetTaxProfileInput = z.input<typeof assetTaxProfileInput>;

/**
 * US dollars held in a non-remunerated account abroad on 31 December, and
 * the value in reais the user declares for them (Bens e Direitos 06/01).
 */
export const foreignCashInput = z.object({
  year: incomeTaxYearSchema,
  amountUsd: nonNegativeDecimal,
  valueBrl: nonNegativeDecimal,
  institution: optionalText(160),
});

export type ForeignCashInput = z.input<typeof foreignCashInput>;

export const removeForeignCashInput = z.object({ year: incomeTaxYearSchema });

export type ForeignCashBalance = {
  year: number;
  amountUsd: string;
  valueBrl: string;
  institution: string | null;
};

/** One bonus issue of the year: exempt income, IRPF type 18. */
export type IncomeTaxBonus = {
  ticker: string;
  effectiveAt: string;
  quantity: string;
  unitCost: string;
  value: string;
  legalName: string | null;
  cnpj: string | null;
};

/** One month of the B3 assessment, BRL amounts with two decimals. */
export type IncomeTaxMonth = {
  /** `YYYY-MM`. */
  month: string;
  /** Gross swing sales of stocks, the base of the R$ 20,000 exemption. */
  stockSales: string;
  exempt: boolean;
  /** Net stock result exempt from tax (positive only in exempt months). */
  exemptGain: string;
  ordinaryResult: string;
  dayTradeResult: string;
  fiiResult: string;
  /** Loss pools after this month. */
  ordinaryLoss: string;
  dayTradeLoss: string;
  fiiLoss: string;
  ordinaryBase: string;
  dayTradeBase: string;
  fiiBase: string;
  ordinaryTax: string;
  dayTradeTax: string;
  fiiTax: string;
  taxDue: string;
  /** IRRF withheld this month (0.005% on sales; 1% on day trades). */
  withheld: string;
  withheldDayTrade: string;
  /** IRRF used against this month's tax. */
  withheldUsed: string;
  /** IRRF still available for later months of the year. */
  withheldCarry: string;
  /** Tax below the DARF minimum carried from earlier months. */
  pendingBefore: string;
  /** DARF to pay for this month (code 6015). */
  darf: string;
  /** Carried to the next month because it is below the minimum. */
  pendingAfter: string;
  /** DARF the user recorded as paid for this month. */
  darfPaid: string | null;
  darfPaidOn: string | null;
  sales: number;
};

/** One realized sale, B3 or foreign. */
export type IncomeTaxSale = {
  ticker: string;
  kind: TaxKind;
  tradedAt: string;
  dayTrade: boolean;
  quantity: string;
  /** Gross sale value in the native currency. */
  grossNative: string;
  /** Result in BRL, `null` when a USD rate is missing. */
  resultBrl: string | null;
};

export type IncomeTaxForeignAsset = {
  ticker: string;
  sales: number;
  /** Gross proceeds in USD. */
  proceedsUsd: string;
  /** Proceeds in BRL at each sale date's rate; `null` if a rate is missing. */
  proceedsBrl: string | null;
  costBrl: string | null;
  resultBrl: string | null;
};

export type IncomeTaxForeign = {
  assets: IncomeTaxForeignAsset[];
  /** Net result of the year's sales; `null` when incomplete. */
  netResult: string | null;
  lossBefore: string;
  lossAfter: string | null;
  base: string | null;
  estimatedTax: string | null;
  /** Tickers with a USD trade lacking its trade-date rate. */
  missingRates: string[];
};

export type IncomeTaxHolding = {
  ticker: string;
  kind: TaxKind;
  currency: "BRL" | "USD";
  /** Suggested IRPF group/code, `null` when the user must choose. */
  group: string | null;
  code: string | null;
  quantityBefore: string;
  quantity: string;
  /** Cost on 31 December of the previous year, BRL; `null` if a USD rate is missing. */
  costBefore: string | null;
  /** Cost on 31 December of the year, BRL; `null` if a USD rate is missing. */
  cost: string | null;
  /** Foreign assets: cost in USD on 31 December of the year. */
  costUsd: string | null;
  averagePrice: string | null;
  legalName: string | null;
  cnpj: string | null;
  /** The user's broker, else the one printed on the latest imported note. */
  broker: string | null;
};

export type IncomeTaxWarning =
  | { code: "before_start"; startYear: number }
  | { code: "not_configured" }
  | { code: "missing_rates"; tickers: string[] }
  | { code: "uncovered_sales"; tickers: string[] }
  /** `stock_br` tickers ending in 11, taxed as units (not FIIs). */
  | { code: "units_assumed"; tickers: string[] }
  | { code: "day_trades"; count: number };

export type IncomeTaxReport = {
  year: number;
  startYear: number;
  /** False for a year before `startYear`: only holdings are meaningful. */
  assessed: boolean;
  months: IncomeTaxMonth[];
  totals: {
    exemptGain: string;
    taxDue: string;
    darf: string;
    darfPaid: string;
    withheld: string;
    withheldDayTrade: string;
    /** IRRF left on 31 December, claimed in the yearly declaration. */
    withheldLeft: string;
    ordinaryLoss: string;
    dayTradeLoss: string;
    fiiLoss: string;
    pendingDarf: string;
  };
  sales: IncomeTaxSale[];
  foreign: IncomeTaxForeign;
  holdings: IncomeTaxHolding[];
  bonuses: IncomeTaxBonus[];
  /** Dollars held abroad on 31 December of the year before and the year. */
  foreignCash: {
    before: ForeignCashBalance | null;
    after: ForeignCashBalance | null;
  };
  warnings: IncomeTaxWarning[];
  /** Calendar years with at least one trade, ascending. */
  years: number[];
};
