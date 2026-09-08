import { describe, expect, it } from "vitest";
import { externalAssetLinks } from "./external-asset-links";

describe("externalAssetLinks", () => {
  it("builds Brazilian research links without provider data", () => {
    expect(externalAssetLinks("ITUB4", "stock_br", "BRL")).toEqual([
      {
        id: "fundamentei",
        href: "https://fundamentei.com/br/itub4",
      },
      {
        id: "investorRelations",
        href: "https://www.google.com/search?q=ITUB4%20rela%C3%A7%C3%B5es%20com%20investidores%20site%20oficial",
      },
      {
        id: "tradingView",
        href: "https://www.tradingview.com/chart/?symbol=BMFBOVESPA%3AITUB4",
      },
    ]);
  });

  it("builds US research links without a market suffix", () => {
    expect(externalAssetLinks("NVDA", "stock_us", "USD")).toEqual([
      {
        id: "fundamentei",
        href: "https://fundamentei.com/us/nvda",
      },
      {
        id: "investorRelations",
        href: "https://www.google.com/search?q=NVDA%20investor%20relations%20official",
      },
      {
        id: "tradingView",
        href: "https://www.tradingview.com/chart/?symbol=NVDA",
      },
    ]);
  });

  it("does not offer market research for non-listed assets", () => {
    expect(externalAssetLinks("Tesouro Selic", "fixed_income", "BRL")).toEqual(
      [],
    );
    expect(externalAssetLinks("BTC", "crypto", "USD")).toEqual([]);
  });
});
