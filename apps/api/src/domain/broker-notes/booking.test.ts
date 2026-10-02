import { describe, expect, it } from "vitest";
import { add, formatDecimal, toDecimal, ZERO } from "../../lib/decimal";
import { tradeCashTotal } from "../positions";
import { apportion, bookLine, bookNote, noteFingerprint } from "./booking";
import type { ParsedBrokerNote, ParsedNoteTrade } from "./types";

function trade(partial: Partial<ParsedNoteTrade> = {}): ParsedNoteTrade {
  return {
    side: "buy",
    sourceKey: "B3:VALE|ON",
    description: "VALE ON",
    ticker: null,
    classHint: "stock_br",
    quantity: "3",
    executionPrice: "68.23",
    grossValue: "204.69",
    netValue: null,
    market: "FRA",
    flags: [],
    settlementDate: "2024-02-02",
    references: {},
    ...partial,
  };
}

function note(partial: Partial<ParsedBrokerNote> = {}): ParsedBrokerNote {
  return {
    format: "inter-dtvm-sinacor",
    currency: "BRL",
    noteNumber: null,
    account: null,
    tradeDate: "2024-01-31",
    settlementDate: "2024-02-02",
    trades: [trade()],
    fees: [],
    purchasesTotal: "204.69",
    salesTotal: "0.00",
    feesTotal: "0.00",
    withheldTax: "0.00",
    dayTradeWithheldTax: "0.00",
    withheldTaxBase: null,
    netAmount: "-204.69",
    ...partial,
  };
}

const sum = (values: bigint[]) => values.reduce((a, b) => add(a, b), ZERO);

describe("apportion", () => {
  it("splits costs in proportion and adds up to the total exactly", () => {
    const weights = ["138.66", "204.69", "70.80", "90.85", "1563.22"].map(
      (value) => toDecimal(value),
    );
    const parts = apportion(toDecimal("0.61"), weights);

    expect(sum(parts)).toBe(toDecimal("0.61"));
    expect(parts.map((part) => formatDecimal(part))).toEqual([
      "0.04089633",
      "0.06037119",
      "0.02088172",
      "0.02679526",
      "0.46105550",
    ]);
  });

  it("hands truncation leftovers to the largest remainders", () => {
    const parts = apportion(toDecimal("0.00000001"), [
      toDecimal("1"),
      toDecimal("2"),
    ]);

    expect(parts).toEqual([ZERO, toDecimal("0.00000001")]);
  });

  it("keeps the sign of a credit and refuses zero weights", () => {
    expect(
      sum(apportion(toDecimal("-0.03"), [toDecimal("1"), toDecimal("1")])),
    ).toBe(toDecimal("-0.03"));
    expect(() => apportion(toDecimal("1"), [ZERO])).toThrow();
  });
});

describe("bookLine", () => {
  it("keeps the document price when it reproduces the line value", () => {
    const line = bookLine(trade(), toDecimal("0.06037119"));

    expect(line.price).toBe("68.23000000");
    expect(line.fees).toBe("0.06037119");
    expect(tradeCashTotal(line)).toBe("204.75");
  });

  it("books the principal over the quantity for rounded fills", () => {
    const line = bookLine(
      trade({
        side: "buy",
        quantity: "0.24288",
        executionPrice: "205.8585",
        grossValue: "50.00",
        netValue: "50.00",
      }),
      ZERO,
    );

    expect(line.executionPrice).toBe("205.85850000");
    expect(line.price).toBe("205.86297760");
    expect(tradeCashTotal(line)).toBe("50.00");
  });

  it("lowers the price for a credit instead of booking negative fees", () => {
    const buy = bookLine(
      trade({ quantity: "2", executionPrice: "10", grossValue: "20.00" }),
      toDecimal("-0.02"),
    );
    const sell = bookLine(
      trade({
        side: "sell",
        quantity: "2",
        executionPrice: "10",
        grossValue: "20.00",
      }),
      toDecimal("-0.02"),
    );

    expect([buy.price, buy.fees, tradeCashTotal(buy)]).toEqual([
      "9.99000000",
      "0.00000000",
      "19.98",
    ]);
    expect([sell.price, sell.fees, tradeCashTotal(sell)]).toEqual([
      "10.01000000",
      "0.00000000",
      "20.02",
    ]);
  });
});

describe("bookNote", () => {
  it("apportions B3 costs and keeps each US line's own fees", () => {
    const b3 = bookNote(
      note({
        trades: [
          trade(),
          trade({
            sourceKey: "B3:TUPY|ON",
            quantity: "3",
            executionPrice: "26.29",
            grossValue: "78.87",
          }),
        ],
        feesTotal: "0.09",
      }),
    );
    const us = bookNote(
      note({
        format: "apex-confirm",
        currency: "USD",
        trades: [
          trade({
            side: "sell",
            quantity: "2",
            executionPrice: "52.6234",
            grossValue: "105.25",
            netValue: "105.24",
          }),
        ],
      }),
    );

    expect(sum(b3.map((line) => toDecimal(line.fees)))).toBe(toDecimal("0.09"));
    expect(us[0]).toMatchObject({ price: "52.62500000", fees: "0.01000000" });
    expect(tradeCashTotal(us[0] as (typeof us)[number])).toBe("105.24");
  });
});

describe("noteFingerprint", () => {
  it("identifies the same note across layouts of one broker and orders", () => {
    const sinacor = note({ trades: [trade(), trade({ quantity: "1" })] });
    const web = note({
      format: "inter-dtvm-web",
      noteNumber: "14802450",
      trades: [trade({ quantity: "1" }), trade({ ticker: "VALE3" })],
    });

    expect(noteFingerprint(web)).toBe(noteFingerprint(sinacor));
  });

  it("separates brokers, dates and contents", () => {
    const base = noteFingerprint(note());

    expect(noteFingerprint(note({ format: "apex-confirm" }))).not.toBe(base);
    expect(noteFingerprint(note({ tradeDate: "2024-02-01" }))).not.toBe(base);
    expect(noteFingerprint(note({ netAmount: "-204.70" }))).not.toBe(base);
  });
});
