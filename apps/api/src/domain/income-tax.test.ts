import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import {
  brokerOfNoteFormat,
  buildIncomeTaxReport,
  type DarfPayment,
  defaultOpening,
  type IncomeTaxOpening,
  taxKindOf,
  type WithheldTaxEntry,
} from "./income-tax";
import type { ConsolidationInput, SplitEvent } from "./positions";

let sequence = 0;

function trade(
  ticker: string,
  side: "buy" | "sell",
  quantity: string,
  price: string,
  tradedAt: string,
  options: {
    fees?: string;
    assetClass?: AssetClass;
    currency?: Currency;
    rate?: string | null;
  } = {},
): ConsolidationInput {
  sequence += 1;
  const currency = options.currency ?? "BRL";

  return {
    ticker,
    assetClass:
      options.assetClass ?? (currency === "USD" ? "stock_us" : "stock_br"),
    currency,
    side,
    quantity,
    price,
    fees: options.fees ?? "0",
    tradedAt,
    createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, sequence)),
    usdBrlRate:
      options.rate === undefined
        ? currency === "USD"
          ? null
          : null
        : options.rate,
  };
}

const OPENING: IncomeTaxOpening = {
  startYear: 2026,
  ordinaryLoss: "0",
  dayTradeLoss: "0",
  fiiLoss: "0",
  foreignLoss: "0",
  pendingDarf: "0",
  configured: true,
};

function report(
  trades: ConsolidationInput[],
  options: {
    year?: number;
    opening?: Partial<IncomeTaxOpening>;
    withheld?: WithheldTaxEntry[];
    splits?: SplitEvent[];
    payments?: DarfPayment[];
  } = {},
) {
  return buildIncomeTaxReport({
    year: options.year ?? 2026,
    trades,
    splits: options.splits ?? [],
    withheld: options.withheld ?? [],
    opening: { ...OPENING, ...options.opening },
    payments: options.payments ?? [],
  });
}

function month(result: ReturnType<typeof report>, key: string) {
  const found = result.months.find((entry) => entry.month === key);
  if (!found) throw new Error(`missing month ${key}`);
  return found;
}

describe("taxKindOf", () => {
  it("maps classes, currencies and B3 suffixes", () => {
    expect(taxKindOf("PETR4", "stock_br", "BRL")).toBe("stock");
    expect(taxKindOf("BRBI11", "stock_br", "BRL")).toBe("unit");
    expect(taxKindOf("AAPL34", "stock_br", "BRL")).toBe("bdr");
    expect(taxKindOf("BOVA11", "etf", "BRL")).toBe("etf");
    expect(taxKindOf("XPML11", "reit", "BRL")).toBe("fii");
    expect(taxKindOf("AAPL34", "bdr", "BRL")).toBe("bdr");
    expect(taxKindOf("VOO", "etf", "USD")).toBe("foreign");
    expect(taxKindOf("EPRT", "reit", "USD")).toBe("foreign");
    expect(taxKindOf("BTC", "crypto", "USD")).toBe("uncovered");
    expect(taxKindOf("CDB", "fixed_income", "BRL")).toBe("uncovered");
  });
});

describe("B3 monthly assessment", () => {
  it("exempts a stock gain when the month's stock sales stay within R$ 20,000", () => {
    const result = report([
      trade("PETR4", "buy", "1000", "10", "2026-01-05"),
      trade("PETR4", "sell", "1000", "20", "2026-02-10"),
    ]);
    const february = month(result, "2026-02");

    expect(february.stockSales).toBe("20000.00");
    expect(february.exempt).toBe(true);
    expect(february.exemptGain).toBe("10000.00");
    expect(february.ordinaryResult).toBe("0.00");
    expect(february.taxDue).toBe("0.00");
    expect(result.totals.exemptGain).toBe("10000.00");
  });

  it("taxes the whole stock gain one cent above the limit", () => {
    const result = report([
      trade("PETR4", "buy", "1000", "10", "2026-01-05"),
      trade("PETR4", "sell", "1000", "20.00001", "2026-02-10"),
    ]);
    const february = month(result, "2026-02");

    expect(february.stockSales).toBe("20000.01");
    expect(february.exempt).toBe(false);
    expect(february.ordinaryResult).toBe("10000.01");
    expect(february.ordinaryTax).toBe("1500.00");
    expect(february.darf).toBe("1500.00");
  });

  it("counts fees in the cost and nets them out of the proceeds", () => {
    const result = report([
      trade("PETR4", "buy", "1000", "20", "2026-01-05", { fees: "10" }),
      trade("PETR4", "sell", "1000", "25", "2026-02-10", { fees: "15" }),
    ]);

    expect(month(result, "2026-02").ordinaryResult).toBe("4975.00");
  });

  it("keeps an exempt month's stock loss to offset later taxable gains", () => {
    const result = report([
      trade("PETR4", "buy", "100", "10", "2026-01-05"),
      trade("PETR4", "sell", "100", "7", "2026-01-20"),
      trade("VALE3", "buy", "1000", "29", "2026-02-02"),
      trade("VALE3", "sell", "1000", "30", "2026-03-10"),
    ]);

    expect(month(result, "2026-01").exempt).toBe(true);
    expect(month(result, "2026-01").ordinaryLoss).toBe("300.00");
    const march = month(result, "2026-03");
    expect(march.ordinaryResult).toBe("1000.00");
    expect(march.ordinaryBase).toBe("700.00");
    expect(march.ordinaryTax).toBe("105.00");
    expect(march.ordinaryLoss).toBe("0.00");
  });

  it("never exempts units, ETFs or BDRs, and flags 11-suffixed stocks", () => {
    const result = report([
      trade("BRBI11", "buy", "100", "10", "2026-01-05"),
      trade("BRBI11", "sell", "100", "15", "2026-02-10"),
      trade("BOVA11", "buy", "10", "100", "2026-01-05", { assetClass: "etf" }),
      trade("BOVA11", "sell", "10", "110", "2026-02-10", { assetClass: "etf" }),
    ]);
    const february = month(result, "2026-02");

    expect(february.stockSales).toBe("0.00");
    expect(february.exempt).toBe(false);
    expect(february.ordinaryResult).toBe("600.00");
    expect(february.ordinaryTax).toBe("90.00");
    expect(result.warnings).toContainEqual({
      code: "units_assumed",
      tickers: ["BRBI11"],
    });
  });

  it("keeps ordinary, day-trade and FII losses in separate pools", () => {
    const result = report([
      trade("XPML11", "buy", "100", "100", "2026-01-05", {
        assetClass: "reit",
      }),
      trade("XPML11", "sell", "100", "90", "2026-01-20", {
        assetClass: "reit",
      }),
      trade("PETR4", "buy", "100", "30", "2026-02-03"),
      trade("PETR4", "sell", "100", "29", "2026-02-03"),
      trade("VALE3", "buy", "1000", "30", "2026-03-02"),
      trade("VALE3", "sell", "1000", "31", "2026-03-20"),
    ]);

    expect(month(result, "2026-01").fiiLoss).toBe("1000.00");
    expect(month(result, "2026-02").dayTradeLoss).toBe("100.00");
    const march = month(result, "2026-03");
    expect(march.ordinaryBase).toBe("1000.00");
    expect(march.ordinaryTax).toBe("150.00");
    expect(march.fiiLoss).toBe("1000.00");
    expect(march.dayTradeLoss).toBe("100.00");
  });

  it("taxes FII gains at 20% after the FII pool", () => {
    const result = report(
      [
        trade("XPML11", "buy", "100", "100", "2026-01-05", {
          assetClass: "reit",
        }),
        trade("XPML11", "sell", "100", "110", "2026-02-20", {
          assetClass: "reit",
        }),
      ],
      { opening: { fiiLoss: "200" } },
    );
    const february = month(result, "2026-02");

    expect(february.fiiResult).toBe("1000.00");
    expect(february.fiiBase).toBe("800.00");
    expect(february.fiiTax).toBe("160.00");
  });

  it("pairs a day trade without touching the position held before", () => {
    const result = report([
      trade("PETR4", "buy", "100", "10", "2026-01-05"),
      trade("PETR4", "buy", "50", "12", "2026-02-10"),
      trade("PETR4", "sell", "80", "13", "2026-02-10"),
    ]);
    const february = month(result, "2026-02");

    expect(february.dayTradeResult).toBe("50.00");
    expect(february.dayTradeTax).toBe("10.00");
    // The 30 units left over sell at the old average of 10.
    expect(february.stockSales).toBe("390.00");
    expect(february.exemptGain).toBe("90.00");
    expect(february.darf).toBe("10.00");
    expect(result.holdings).toEqual([
      expect.objectContaining({
        ticker: "PETR4",
        quantity: "70.00000000",
        cost: "700.00",
        averagePrice: "10.0000",
        group: "03",
        code: "01",
      }),
    ]);
    expect(result.warnings).toContainEqual({ code: "day_trades", count: 1 });
  });

  it("pairs first buy with first sell and splits fees by quantity", () => {
    const result = report([
      trade("PETR4", "buy", "100", "10", "2026-02-10", { fees: "2" }),
      trade("PETR4", "buy", "100", "11", "2026-02-10", { fees: "2" }),
      trade("PETR4", "sell", "150", "12", "2026-02-10", { fees: "3" }),
    ]);
    const february = month(result, "2026-02");

    // Cost: 1002 + half of 1102 = 1553; proceeds 1800 - 3 = 1797.
    expect(february.dayTradeResult).toBe("244.00");
    expect(result.holdings[0]).toMatchObject({
      quantity: "50.00000000",
      cost: "551.00",
    });
  });

  it("offsets IRRF within the year and leaves the rest for the declaration", () => {
    const result = report(
      [
        trade("VALE3", "buy", "1000", "30", "2026-01-05"),
        trade("VALE3", "sell", "1000", "31", "2026-03-20"),
      ],
      {
        withheld: [
          {
            tradeDate: "2026-01-05",
            withheldTax: "0.50",
            dayTradeWithheldTax: "0",
          },
          {
            tradeDate: "2026-03-20",
            withheldTax: "1.55",
            dayTradeWithheldTax: "0",
          },
          {
            tradeDate: "2026-11-03",
            withheldTax: "2.10",
            dayTradeWithheldTax: "1.00",
          },
        ],
      },
    );

    expect(month(result, "2026-01").withheldCarry).toBe("0.50");
    const march = month(result, "2026-03");
    expect(march.taxDue).toBe("150.00");
    expect(march.withheldUsed).toBe("2.05");
    expect(march.darf).toBe("147.95");
    const november = month(result, "2026-11");
    expect(november.withheld).toBe("1.10");
    expect(november.withheldDayTrade).toBe("1.00");
    expect(result.totals.withheldLeft).toBe("2.10");

    const next = report(
      [
        trade("VALE3", "buy", "1000", "30", "2026-01-05"),
        trade("VALE3", "sell", "1000", "31", "2027-03-20"),
      ],
      {
        year: 2027,
        withheld: [
          {
            tradeDate: "2026-11-03",
            withheldTax: "2.10",
            dayTradeWithheldTax: "0",
          },
        ],
      },
    );
    expect(month(next, "2027-03").withheldUsed).toBe("0.00");
    expect(month(next, "2027-03").darf).toBe("150.00");
  });

  it("carries tax below the R$ 10 DARF minimum, across years too", () => {
    const result = report(
      [
        trade("VALE3", "buy", "1000", "30", "2026-01-05"),
        trade("VALE3", "sell", "1000", "30.04", "2026-01-20"),
        trade("ITSA4", "buy", "2000", "10", "2026-02-02"),
        trade("ITSA4", "sell", "2000", "10.02", "2026-02-20"),
      ],
      { opening: { pendingDarf: "3.00" } },
    );

    const january = month(result, "2026-01");
    expect(january.taxDue).toBe("6.00");
    expect(january.pendingBefore).toBe("3.00");
    expect(january.darf).toBe("0.00");
    expect(january.pendingAfter).toBe("9.00");
    const february = month(result, "2026-02");
    expect(february.taxDue).toBe("6.00");
    expect(february.darf).toBe("15.00");
    expect(february.pendingAfter).toBe("0.00");
  });

  it("starts at the opening balances and ignores results already declared", () => {
    const trades = [
      trade("VALE3", "buy", "2000", "30", "2025-03-05"),
      trade("VALE3", "sell", "1000", "40", "2025-06-20"),
      trade("VALE3", "sell", "1000", "33", "2026-04-20"),
    ];
    const result = report(trades, { opening: { ordinaryLoss: "1000" } });

    expect(result.months).toHaveLength(12);
    const april = month(result, "2026-04");
    expect(april.ordinaryResult).toBe("3000.00");
    expect(april.ordinaryBase).toBe("2000.00");
    expect(april.ordinaryTax).toBe("300.00");

    const before = report(trades, { year: 2025 });
    expect(before.assessed).toBe(false);
    expect(before.months).toEqual([]);
    expect(before.warnings).toContainEqual({
      code: "before_start",
      startYear: 2026,
    });
    expect(before.holdings[0]).toMatchObject({
      quantity: "1000.00000000",
      cost: "30000.00",
    });
  });

  it("applies splits on their date for year-end holdings", () => {
    const result = report(
      [
        trade("WEGE3", "buy", "100", "10", "2025-05-05"),
        trade("WEGE3", "sell", "50", "6", "2026-04-10"),
      ],
      {
        splits: [
          {
            ticker: "WEGE3",
            effectiveAt: "2026-03-01",
            fromQuantity: "1",
            toQuantity: "2",
          },
        ],
      },
    );

    expect(month(result, "2026-04").exemptGain).toBe("50.00");
    expect(result.holdings).toEqual([
      expect.objectContaining({
        ticker: "WEGE3",
        quantityBefore: "100.00000000",
        costBefore: "1000.00",
        quantity: "150.00000000",
        cost: "750.00",
      }),
    ]);
  });

  it("reports uncovered sales without assessing them", () => {
    const result = report([
      trade("BTC", "buy", "1", "100000", "2026-01-05", {
        assetClass: "crypto",
      }),
      trade("BTC", "sell", "1", "200000", "2026-02-05", {
        assetClass: "crypto",
      }),
    ]);

    expect(month(result, "2026-02").taxDue).toBe("0.00");
    expect(result.sales).toEqual([]);
    expect(result.holdings).toEqual([]);
    expect(result.warnings).toContainEqual({
      code: "uncovered_sales",
      tickers: ["BTC"],
    });
  });
});

describe("bonus issues and DARF payments", () => {
  it("adds the attributed cost and reports the bonus as exempt income", () => {
    // ITUB3-like: 298 held, 10% bonus at R$ 18,00 attributed per share.
    const result = report(
      [
        trade("ITUB3", "buy", "298", "30.5588", "2025-12-31"),
        trade("ITUB3", "sell", "100", "40", "2026-06-10"),
      ],
      {
        splits: [
          {
            ticker: "ITUB3",
            effectiveAt: "2026-03-20",
            fromQuantity: "298",
            toQuantity: "327.8",
            kind: "bonus",
            unitCost: "18",
          },
        ],
      },
    );

    expect(result.bonuses).toEqual([
      expect.objectContaining({
        ticker: "ITUB3",
        effectiveAt: "2026-03-20",
        quantity: "29.80000000",
        unitCost: "18.00000000",
        value: "536.40",
      }),
    ]);
    // Cost 298 × 30.5588 = 9106.5224, + 536.40 = 9642.9224 over 327.8
    // shares; selling 100 releases 2941.71 and keeps 6701.21.
    const june = month(result, "2026-06");
    expect(june.stockSales).toBe("4000.00");
    expect(june.exemptGain).toBe("1058.29");
    expect(result.holdings[0]).toMatchObject({
      quantityBefore: "298.00000000",
      costBefore: "9106.52",
      quantity: "227.80000000",
      cost: "6701.21",
    });
  });

  it("keeps a split cost-neutral", () => {
    const result = report([trade("WEGE3", "buy", "100", "10", "2026-01-05")], {
      splits: [
        {
          ticker: "WEGE3",
          effectiveAt: "2026-03-01",
          fromQuantity: "1",
          toQuantity: "2",
          kind: "split",
          unitCost: null,
        },
      ],
    });

    expect(result.bonuses).toEqual([]);
    expect(result.holdings[0]).toMatchObject({
      quantity: "200.00000000",
      cost: "1000.00",
    });
  });

  it("attaches recorded DARF payments to their month and totals", () => {
    const result = report(
      [
        trade("VALE3", "buy", "1000", "30", "2026-01-05"),
        trade("VALE3", "sell", "1000", "31", "2026-03-20"),
      ],
      {
        payments: [
          { month: "2026-03", paidOn: "2026-04-29", amount: "150" },
          { month: "2025-12", paidOn: "2026-01-30", amount: "99" },
        ],
      },
    );

    expect(month(result, "2026-03")).toMatchObject({
      darf: "150.00",
      darfPaid: "150.00",
      darfPaidOn: "2026-04-29",
    });
    expect(month(result, "2026-04").darfPaid).toBeNull();
    expect(result.totals.darfPaid).toBe("150.00");
  });
});

describe("foreign assets", () => {
  const usd = { currency: "USD" as const };

  it("converts cost and proceeds at each trade's own rate", () => {
    const result = report(
      [
        trade("AAPL", "buy", "10", "100", "2026-01-05", {
          ...usd,
          fees: "1",
          rate: "5.0",
        }),
        trade("AAPL", "sell", "4", "150", "2026-06-10", {
          ...usd,
          fees: "1",
          rate: "5.5",
        }),
      ],
      { opening: { foreignLoss: "300" } },
    );

    expect(result.foreign.assets).toEqual([
      {
        ticker: "AAPL",
        sales: 1,
        proceedsUsd: "600.00",
        proceedsBrl: "3294.50",
        costBrl: "2002.00",
        resultBrl: "1292.50",
      },
    ]);
    expect(result.foreign.netResult).toBe("1292.50");
    expect(result.foreign.base).toBe("992.50");
    expect(result.foreign.estimatedTax).toBe("148.88");
    expect(result.foreign.lossAfter).toBe("0.00");
    // Foreign sales never enter the monthly B3 assessment.
    expect(month(result, "2026-06").taxDue).toBe("0.00");
    expect(result.holdings).toEqual([
      expect.objectContaining({
        ticker: "AAPL",
        currency: "USD",
        quantity: "6.00000000",
        cost: "3003.00",
        costUsd: "600.60",
        group: "03",
        code: "01",
      }),
    ]);
  });

  it("carries a foreign loss to the next year", () => {
    const trades = [
      trade("MSFT", "buy", "10", "100", "2026-01-05", { ...usd, rate: "5" }),
      trade("MSFT", "sell", "10", "90", "2026-06-10", { ...usd, rate: "5" }),
      trade("NVDA", "buy", "10", "100", "2027-01-05", { ...usd, rate: "5" }),
      trade("NVDA", "sell", "10", "130", "2027-06-10", { ...usd, rate: "5" }),
    ];

    expect(report(trades).foreign.lossAfter).toBe("500.00");
    const next = report(trades, { year: 2027 });
    expect(next.foreign.lossBefore).toBe("500.00");
    expect(next.foreign.base).toBe("1000.00");
    expect(next.foreign.estimatedTax).toBe("150.00");
  });

  it("refuses to guess a missing rate", () => {
    const result = report([
      trade("AAPL", "buy", "10", "100", "2026-01-05", { ...usd, rate: null }),
      trade("AAPL", "sell", "10", "150", "2026-06-10", { ...usd, rate: "5.5" }),
    ]);

    expect(result.foreign.netResult).toBeNull();
    expect(result.foreign.estimatedTax).toBeNull();
    expect(result.foreign.assets[0]?.resultBrl).toBeNull();
    expect(result.warnings).toContainEqual({
      code: "missing_rates",
      tickers: ["AAPL"],
    });
  });

  it("keeps the declared opening cost of a position booked at an average rate", () => {
    // ir@gmail.com's GOOG: R$ 4.120,46 / US$ 755,89 on 31/12/2025.
    const result = report(
      [
        trade("GOOG", "buy", "4.39622", "171.94089468", "2025-12-31", {
          ...usd,
          rate: "5.45113707",
        }),
      ],
      { year: 2026 },
    );

    expect(result.holdings[0]).toMatchObject({
      costBefore: "4120.46",
      cost: "4120.46",
      costUsd: "755.89",
    });
  });
});

describe("defaultOpening", () => {
  it("starts at the first trade's year with nothing carried", () => {
    expect(
      defaultOpening(
        [{ tradedAt: "2024-05-01" }, { tradedAt: "2023-02-01" }],
        2026,
      ),
    ).toMatchObject({ startYear: 2023, configured: false, ordinaryLoss: "0" });
    expect(defaultOpening([], 2026).startYear).toBe(2026);
  });
});

describe("brokerOfNoteFormat", () => {
  it("names the broker each note layout comes from", () => {
    expect(brokerOfNoteFormat("inter-dtvm-sinacor")).toBe(
      "Inter DTVM Ltda. (CNPJ 18.945.670/0001-46)",
    );
    expect(brokerOfNoteFormat("apex-confirm")).toContain("Apex Clearing");
    expect(brokerOfNoteFormat("unknown")).toBeNull();
  });
});
