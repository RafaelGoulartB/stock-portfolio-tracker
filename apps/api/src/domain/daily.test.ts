import type {
  AssetClass,
  Currency,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import {
  buildDailyTracking,
  dailyPreviousFxDay,
  dailySnapshotDate,
  dailyValuationDay,
  previousWeekday,
} from "./daily";
import {
  type ConsolidationInput,
  consolidatePositions,
  convertPositions,
  type ValuationQuote,
  valuePositions,
  withCashPosition,
} from "./positions";

let sequence = 0;

function tx(
  partial: Partial<ConsolidationInput> & Pick<ConsolidationInput, "side">,
): ConsolidationInput {
  sequence += 1;

  return {
    ticker: "PETR4",
    assetClass: "stock_br",
    currency: "BRL",
    quantity: "1",
    price: "10",
    fees: "0",
    tradedAt: "2026-01-01",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sequence)),
    ...partial,
  };
}

/** Noon UTC stays on the same calendar day in America/Sao_Paulo. */
function at(day: string): Date {
  return new Date(`${day}T15:00:00.000Z`);
}

function quote(
  ticker: string,
  price: string,
  previousClose: string,
): ValuationQuote {
  return {
    ticker,
    price,
    asOf: "2026-09-09",
    previousClose,
    previousCloseAsOf: "2026-09-08",
  };
}

function valued(input: {
  ticker: string;
  assetClass?: AssetClass;
  currency?: Currency;
  quantity: string;
  cost: string;
  price: string;
  display: Currency;
  rate: string | null;
}): ValuedPosition {
  const currency = input.currency ?? "BRL";
  const native = consolidatePositions([
    tx({
      ticker: input.ticker,
      assetClass: input.assetClass ?? "stock_br",
      currency,
      side: "buy",
      quantity: input.quantity,
      price: input.cost,
    }),
  ]);
  const [position] = valuePositions(
    convertPositions(native, input.display, input.rate),
    new Map([
      [
        input.ticker,
        { ticker: input.ticker, price: input.price, asOf: "2026-09-09" },
      ],
    ]),
    input.display,
    input.rate,
  );

  if (!position) {
    throw new Error(`expected ${input.ticker}`);
  }

  return position;
}

describe("previousWeekday", () => {
  it("steps back one day inside the week", () => {
    expect(previousWeekday("2026-09-09")).toBe("2026-09-08");
  });

  it("skips the weekend from Monday", () => {
    expect(previousWeekday("2026-09-07")).toBe("2026-09-04");
  });

  it("lands on Friday from Saturday and Sunday", () => {
    expect(previousWeekday("2026-09-05")).toBe("2026-09-04");
    expect(previousWeekday("2026-09-06")).toBe("2026-09-04");
  });
});

describe("dailySnapshotDate", () => {
  it("keeps weekdays on the live book", () => {
    expect(dailySnapshotDate(at("2026-09-09"))).toBeUndefined();
    expect(dailyValuationDay(at("2026-09-09"))).toBe("2026-09-09");
  });

  it("uses Friday on the weekend", () => {
    expect(dailySnapshotDate(at("2026-09-05"))).toBe("2026-09-04");
    expect(dailySnapshotDate(at("2026-09-06"))).toBe("2026-09-04");
    expect(dailyValuationDay(at("2026-09-06"))).toBe("2026-09-04");
  });
});

describe("dailyPreviousFxDay", () => {
  it("uses the weekday before the latest quote when the book is live", () => {
    expect(dailyPreviousFxDay(undefined, "2026-09-08", at("2026-09-09"))).toBe(
      "2026-09-07",
    );
  });

  it("uses the weekday before the weekend snapshot", () => {
    expect(
      dailyPreviousFxDay("2026-09-04", "2026-09-04", at("2026-09-06")),
    ).toBe("2026-09-03");
  });

  it("falls back to the calendar weekday before today when there is no quote", () => {
    expect(dailyPreviousFxDay(undefined, null, at("2026-09-09"))).toBe(
      "2026-09-08",
    );
  });
});

describe("buildDailyTracking", () => {
  it("includes the USD/BRL move when a USD asset is shown in BRL", () => {
    const apple = valued({
      ticker: "AAPL",
      assetClass: "stock_us",
      currency: "USD",
      quantity: "10",
      cost: "100",
      price: "100",
      display: "BRL",
      rate: "5.5",
    });
    const result = buildDailyTracking({
      positions: [apple],
      quotes: new Map([["AAPL", quote("AAPL", "100", "100")]]),
      displayCurrency: "BRL",
      usdBrlRate: "5.5",
      previousUsdBrlRate: "5",
    });
    const [row] = result.positions;

    expect(row).toMatchObject({
      convertedPreviousMarketValue: "5000.00",
      convertedMarketValue: "5500.00",
      dailyChange: "500.00",
      dailyChangePercent: "0.10000000",
    });
    expect(result.summary).toMatchObject({
      dailyChange: "500.00",
      dailyChangePercent: "0.10000000",
      advancing: 1,
      comparablePositions: 1,
    });
  });

  it("compounds the native price move with the FX move", () => {
    const uber = valued({
      ticker: "UBER",
      assetClass: "stock_us",
      currency: "USD",
      quantity: "10",
      cost: "100",
      price: "110",
      display: "BRL",
      rate: "5.5",
    });
    const [row] = buildDailyTracking({
      positions: [uber],
      quotes: new Map([["UBER", quote("UBER", "110", "100")]]),
      displayCurrency: "BRL",
      usdBrlRate: "5.5",
      previousUsdBrlRate: "5",
    }).positions;

    // Yesterday 10×100×5 = 5000 BRL; today 10×110×5.5 = 6050 BRL.
    expect(row).toMatchObject({
      convertedPreviousMarketValue: "5000.00",
      convertedMarketValue: "6050.00",
      dailyChange: "1050.00",
      dailyChangePercent: "0.21000000",
    });
  });

  it("ignores FX for a BRL asset shown in BRL", () => {
    const petr = valued({
      ticker: "PETR4",
      quantity: "100",
      cost: "10",
      price: "11",
      display: "BRL",
      rate: "5.5",
    });
    const [row] = buildDailyTracking({
      positions: [petr],
      quotes: new Map([["PETR4", quote("PETR4", "11", "10")]]),
      displayCurrency: "BRL",
      usdBrlRate: "5.5",
      previousUsdBrlRate: "5",
    }).positions;

    expect(row).toMatchObject({
      dailyChange: "100.00",
      dailyChangePercent: "0.10000000",
    });
  });

  it("includes the dollar move on BRL cash when the display is USD", () => {
    const [cash] = withCashPosition([], "550", "USD", "5.5");
    const result = buildDailyTracking({
      positions: [cash],
      quotes: new Map(),
      displayCurrency: "USD",
      usdBrlRate: "5.5",
      previousUsdBrlRate: "5",
    });
    const [row] = result.positions;

    expect(row).toMatchObject({
      ticker: "CASH",
      convertedPreviousMarketValue: "110.00",
      convertedMarketValue: "100.00",
      dailyChange: "-10.00",
      dailyChangePercent: "-0.09090909",
    });
    expect(result.summary.declining).toBe(1);
  });

  it("keeps BRL cash flat when the display is BRL", () => {
    const [cash] = withCashPosition([], "18803.13", "BRL", null);
    const [row] = buildDailyTracking({
      positions: [cash],
      quotes: new Map(),
      displayCurrency: "BRL",
      usdBrlRate: null,
      previousUsdBrlRate: null,
    }).positions;

    expect(row).toMatchObject({
      dailyChange: "0.00",
      dailyChangePercent: "0.00000000",
    });
  });

  it("uses yesterday's wealth, including cash, as the portfolio percent base", () => {
    const petr = valued({
      ticker: "PETR4",
      quantity: "100",
      cost: "10",
      price: "11",
      display: "BRL",
      rate: null,
    });
    const positions = withCashPosition([petr], "50", "BRL", null);
    const result = buildDailyTracking({
      positions,
      quotes: new Map([["PETR4", quote("PETR4", "11", "10")]]),
      displayCurrency: "BRL",
      usdBrlRate: null,
      previousUsdBrlRate: null,
    });

    expect(result.summary).toMatchObject({
      previousComparableValue: "1050.00",
      currentComparableValue: "1150.00",
      dailyChange: "100.00",
      dailyChangePercent: "0.09523810",
      comparablePositions: 2,
      unchanged: 1,
      advancing: 1,
    });
  });

  it("matches the frozen-FX result when both days share a rate", () => {
    const apple = valued({
      ticker: "AAPL",
      assetClass: "stock_us",
      currency: "USD",
      quantity: "10",
      cost: "100",
      price: "110",
      display: "BRL",
      rate: "5",
    });
    const [row] = buildDailyTracking({
      positions: [apple],
      quotes: new Map([["AAPL", quote("AAPL", "110", "100")]]),
      displayCurrency: "BRL",
      usdBrlRate: "5",
      previousUsdBrlRate: "5",
    }).positions;

    expect(row).toMatchObject({
      dailyChange: "500.00",
      dailyChangePercent: "0.10000000",
    });
  });

  it("falls back to the current rate when no previous rate is supplied", () => {
    const apple = valued({
      ticker: "AAPL",
      assetClass: "stock_us",
      currency: "USD",
      quantity: "10",
      cost: "100",
      price: "100",
      display: "BRL",
      rate: "5.5",
    });
    const [row] = buildDailyTracking({
      positions: [apple],
      quotes: new Map([["AAPL", quote("AAPL", "100", "100")]]),
      displayCurrency: "BRL",
      usdBrlRate: "5.5",
      previousUsdBrlRate: null,
    }).positions;

    expect(row).toMatchObject({
      dailyChange: "0.00",
      dailyChangePercent: "0.00000000",
    });
  });

  it("leaves unquoted tickers without a daily comparison", () => {
    const petr = valued({
      ticker: "PETR4",
      quantity: "100",
      cost: "10",
      price: "11",
      display: "BRL",
      rate: null,
    });
    const [row] = buildDailyTracking({
      positions: [petr],
      quotes: new Map(),
      displayCurrency: "BRL",
      usdBrlRate: null,
      previousUsdBrlRate: null,
    }).positions;

    expect(row).toMatchObject({
      previousClose: null,
      dailyChange: null,
      dailyChangePercent: null,
    });
  });
});
