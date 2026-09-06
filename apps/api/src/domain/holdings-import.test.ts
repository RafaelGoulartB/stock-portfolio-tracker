import {
  inferAssetClass,
  parseBrazilianNumber,
  parseHoldingsImport,
  parseMoneyCell,
  splitCsvLine,
} from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";

const SAMPLE = `Ativo,Qtd,"Preço médio"
PRIO3,300,"R$ 43,40"
ITUB3,350,"R$ 31,95"
AUGO,31,"R$ 289,83"
GOOG,"4,78","R$ 989,79"
FLRY3,400,"R$ 14,30"
FIQE3,2.800,"R$ 4,15"`;

describe("parseBrazilianNumber", () => {
  it("handles Brazilian thousands and decimal comma", () => {
    expect(parseBrazilianNumber("2.800")).toBe("2800");
    expect(parseBrazilianNumber("4,78")).toBe("4.78");
    expect(parseBrazilianNumber("1.234,56")).toBe("1234.56");
    expect(parseBrazilianNumber("32.15")).toBe("32.15");
  });
});

describe("parseMoneyCell", () => {
  it("reads currency prefixes", () => {
    expect(parseMoneyCell("R$ 43,40")).toEqual({
      currency: "BRL",
      amount: "43.4",
    });
    expect(parseMoneyCell("US$ 132,00")).toEqual({
      currency: "USD",
      amount: "132",
    });
  });
});

describe("inferAssetClass", () => {
  it("classifies B3 and US tickers", () => {
    expect(inferAssetClass("PETR4", "BRL")).toBe("stock_br");
    expect(inferAssetClass("FIQE3", "BRL")).toBe("stock_br");
    expect(inferAssetClass("GOOG", "BRL")).toBe("stock_us");
    expect(inferAssetClass("NVDA", "USD")).toBe("stock_us");
  });
});

describe("parseHoldingsImport", () => {
  it("parses the sample portfolio paste", () => {
    const result = parseHoldingsImport(SAMPLE);

    expect(result.issues).toEqual([]);
    expect(result.rows).toEqual([
      {
        ticker: "PRIO3",
        quantity: "300",
        price: "43.4",
        currency: "BRL",
        assetClass: "stock_br",
        line: 2,
      },
      {
        ticker: "ITUB3",
        quantity: "350",
        price: "31.95",
        currency: "BRL",
        assetClass: "stock_br",
        line: 3,
      },
      {
        ticker: "AUGO",
        quantity: "31",
        price: "289.83",
        currency: "BRL",
        assetClass: "stock_us",
        line: 4,
      },
      {
        ticker: "GOOG",
        quantity: "4.78",
        price: "989.79",
        currency: "BRL",
        assetClass: "stock_us",
        line: 5,
      },
      {
        ticker: "FLRY3",
        quantity: "400",
        price: "14.3",
        currency: "BRL",
        assetClass: "stock_br",
        line: 6,
      },
      {
        ticker: "FIQE3",
        quantity: "2800",
        price: "4.15",
        currency: "BRL",
        assetClass: "stock_br",
        line: 7,
      },
    ]);
  });

  it("splits quoted CSV cells", () => {
    expect(splitCsvLine('GOOG,"4,78","R$ 989,79"')).toEqual([
      "GOOG",
      "4,78",
      "R$ 989,79",
    ]);
  });

  it("reports bad lines without dropping valid ones", () => {
    const result = parseHoldingsImport(
      [
        "Ativo,Qtd,Preco",
        "PETR4,10,R$ 30,00",
        "BAD,,",
        "VALE3,5,R$ 60,00",
      ].join("\n"),
    );

    expect(result.rows.map((row) => row.ticker)).toEqual(["PETR4", "VALE3"]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.line).toBe(3);
  });
});
