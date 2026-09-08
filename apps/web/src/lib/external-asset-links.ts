import type { AssetClass, Currency } from "@portifolio-tracker/shared";

export type ExternalAssetLink = {
  id: "fundamentei" | "investorRelations";
  href: string;
};

const PUBLIC_MARKET_ASSET_CLASSES: ReadonlySet<AssetClass> = new Set([
  "stock_br",
  "stock_us",
  "reit",
  "etf",
  "bdr",
]);

/**
 * Builds research destinations without fetching metadata per table row.
 * Fundamentei is deterministic; RI uses a localized search because issuers do
 * not follow a stable URL convention and quote providers expose, at most, the
 * general corporate website.
 */
export function externalAssetLinks(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency,
): ExternalAssetLink[] {
  if (!PUBLIC_MARKET_ASSET_CLASSES.has(assetClass)) {
    return [];
  }

  const normalizedTicker = ticker.trim().toLowerCase();

  if (!normalizedTicker) {
    return [];
  }

  const market = currency === "BRL" ? "br" : "us";
  const investorRelationsQuery =
    market === "br"
      ? `${ticker.trim().toUpperCase()} relações com investidores site oficial`
      : `${ticker.trim().toUpperCase()} investor relations official`;

  return [
    {
      id: "fundamentei",
      href: `https://fundamentei.com/${market}/${encodeURIComponent(normalizedTicker)}`,
    },
    {
      id: "investorRelations",
      href: `https://www.google.com/search?q=${encodeURIComponent(investorRelationsQuery)}`,
    },
  ];
}
