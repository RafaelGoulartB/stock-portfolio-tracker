import { Trans } from "@lingui/react/macro";
import type { AssetClass, TransactionSide } from "@portifolio-tracker/shared";

/** Translated side badge content shared by holdings and history tables. */
export function SideLabel({ side }: { side: TransactionSide }) {
  if (side === "buy") {
    return <Trans id="side.buy">Buy</Trans>;
  }

  return <Trans id="side.sell">Sell</Trans>;
}

/** Translated asset class name shared by holdings and history tables. */
export function AssetClassLabel({ assetClass }: { assetClass: AssetClass }) {
  switch (assetClass) {
    case "stock":
      return <Trans id="assetClass.stock">Stock</Trans>;
    case "reit":
      return <Trans id="assetClass.reit">REIT</Trans>;
    case "etf":
      return <Trans id="assetClass.etf">ETF</Trans>;
    case "bdr":
      return <Trans id="assetClass.bdr">BDR</Trans>;
    case "crypto":
      return <Trans id="assetClass.crypto">Crypto</Trans>;
    case "fixed_income":
      return <Trans id="assetClass.fixedIncome">Fixed income</Trans>;
    case "other":
      return <Trans id="assetClass.other">Other</Trans>;
  }
}
