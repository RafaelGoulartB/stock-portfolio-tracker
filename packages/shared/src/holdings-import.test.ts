import { describe, expect, it } from "vitest";
import {
  bookHoldingRowSchema,
  bookHoldingsInput,
  inferAssetClass,
  parseBrazilianNumber,
  parseHoldingsImport,
  parseMoneyCell,
  splitCsvLine,
} from "./holdings-import";

describe("bookHoldingRowSchema", () => {
  const validRow = {
    ticker: "petr4",
    assetClass: "stock_br",
    currency: "BRL",
    quantity: "100",
    price: "30.5",
  };

  it("normalizes the ticker to upper case", () => {
    expect(bookHoldingRowSchema.parse(validRow).ticker).toBe("PETR4");
  });

  it("rejects a zero quantity or price", () => {
    expect(
      bookHoldingRowSchema.safeParse({ ...validRow, quantity: "0" }).success,
    ).toBe(false);
    expect(
      bookHoldingRowSchema.safeParse({ ...validRow, price: "0" }).success,
    ).toBe(false);
  });
});

describe("bookHoldingsInput", () => {
  const row = {
    ticker: "PETR4",
    assetClass: "stock_br",
    currency: "BRL",
    quantity: "100",
    price: "30.5",
  };

  it("accepts a valid batch with a trade date", () => {
    const parsed = bookHoldingsInput.parse({
      tradedAt: "2026-01-02",
      holdings: [row],
    });

    expect(parsed.holdings).toHaveLength(1);
  });

  it("requires at least one holding", () => {
    expect(
      bookHoldingsInput.safeParse({ tradedAt: "2026-01-02", holdings: [] })
        .success,
    ).toBe(false);
  });

  it("rejects an invalid trade date", () => {
    expect(
      bookHoldingsInput.safeParse({ tradedAt: "nope", holdings: [row] })
        .success,
    ).toBe(false);
  });
});

describe("parseBrazilianNumber edge cases", () => {
  it("returns null for empty, zero and non-numeric text", () => {
    expect(parseBrazilianNumber("")).toBeNull();
    expect(parseBrazilianNumber("0")).toBeNull();
    expect(parseBrazilianNumber("abc")).toBeNull();
  });

  it("keeps the sign for negative values", () => {
    expect(parseBrazilianNumber("-4,78")).toBe("-4.78");
  });

  it("caps the fraction at eight places", () => {
    expect(parseBrazilianNumber("1,123456789")).toBe("1.12345678");
  });
});

describe("parseMoneyCell prefixes", () => {
  it("recognizes plain-dollar and USD prefixes as USD", () => {
    expect(parseMoneyCell("$ 12,50")).toEqual({
      currency: "USD",
      amount: "12.5",
    });
    expect(parseMoneyCell("USD 12,50")).toEqual({
      currency: "USD",
      amount: "12.5",
    });
  });

  it("defaults to BRL when no prefix is present", () => {
    expect(parseMoneyCell("43,40")).toEqual({
      currency: "BRL",
      amount: "43.4",
    });
  });
});

describe("splitCsvLine", () => {
  it("splits on comma, semicolon and tab", () => {
    expect(splitCsvLine("A;B\tC,D")).toEqual(["A", "B", "C", "D"]);
  });

  it("unescapes doubled quotes inside a quoted cell", () => {
    expect(splitCsvLine('"a""b",c')).toEqual(['a"b', "c"]);
  });
});

describe("inferAssetClass fallback", () => {
  it("falls back to currency for unusual symbols", () => {
    expect(inferAssetClass("BRK.B", "USD")).toBe("stock_us");
    expect(inferAssetClass("BRK.B", "BRL")).toBe("stock_br");
  });
});

describe("parseHoldingsImport issues", () => {
  it("flags duplicate tickers and short rows", () => {
    const result = parseHoldingsImport(
      ["PETR4,10,R$ 30,00", "PETR4,5,R$ 31,00", "ONLYONE"].join("\n"),
    );

    expect(result.rows.map((r) => r.ticker)).toEqual(["PETR4"]);
    const messages = result.issues.map((issue) => issue.message);
    expect(messages).toContain("Duplicate ticker PETR4");
    expect(messages).toContain("Expected ticker, quantity and average price");
  });

  it("strips a UTF-8 BOM and skips a recognized header", () => {
    const result = parseHoldingsImport(
      "\uFEFFTicker,Qty,Price\nVALE3,5,R$ 60,00",
    );

    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.ticker).toBe("VALE3");
  });
});
