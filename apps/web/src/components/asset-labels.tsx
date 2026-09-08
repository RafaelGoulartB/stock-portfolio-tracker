import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type {
  AssetClass,
  Currency,
  TransactionSide,
} from "@portifolio-tracker/shared";
import { memo } from "react";
import { Badge } from "@/components/ui/badge";

/** Translated side badge content shared by holdings and history tables. */
function SideLabelComponent({ side }: { side: TransactionSide }) {
  if (side === "buy") {
    return <Trans id="side.buy">Buy</Trans>;
  }

  return <Trans id="side.sell">Sell</Trans>;
}

/** Translated asset class name shared by holdings and history tables. */
function AssetClassLabelComponent({ assetClass }: { assetClass: AssetClass }) {
  switch (assetClass) {
    case "stock_br":
      return <Trans id="assetClass.stockBr">Brazilian stock</Trans>;
    case "stock_us":
      return <Trans id="assetClass.stockUs">US stock</Trans>;
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
    case "cash":
      return <Trans id="assetClass.cash">Cash</Trans>;
    case "other":
      return <Trans id="assetClass.other">Other</Trans>;
  }
}

/** ISO currency code of a trade or position. Codes need no translation. */
function CurrencyBadgeComponent({ currency }: { currency: Currency }) {
  return (
    <Badge variant="outline" className="tabular-nums">
      {currency}
    </Badge>
  );
}

/**
 * Same names as {@link AssetClassLabel} as a plain string, for places that
 * cannot render an element: chart axes, tooltips and aria labels.
 */
export function assetClassText(assetClass: AssetClass, i18n: I18n): string {
  switch (assetClass) {
    case "stock_br":
      return i18n._(
        msg({ id: "assetClass.stockBr", message: "Brazilian stock" }),
      );
    case "stock_us":
      return i18n._(msg({ id: "assetClass.stockUs", message: "US stock" }));
    case "reit":
      return i18n._(msg({ id: "assetClass.reit", message: "REIT" }));
    case "etf":
      return i18n._(msg({ id: "assetClass.etf", message: "ETF" }));
    case "bdr":
      return i18n._(msg({ id: "assetClass.bdr", message: "BDR" }));
    case "crypto":
      return i18n._(msg({ id: "assetClass.crypto", message: "Crypto" }));
    case "fixed_income":
      return i18n._(
        msg({ id: "assetClass.fixedIncome", message: "Fixed income" }),
      );
    case "cash":
      return i18n._(msg({ id: "assetClass.cash", message: "Cash" }));
    case "other":
      return i18n._(msg({ id: "assetClass.other", message: "Other" }));
  }
}

/**
 * Memoized: these render once per row in every table and depend on a single
 * primitive. `Trans` still reacts to a locale change through context.
 */
export const SideLabel = memo(SideLabelComponent);
export const AssetClassLabel = memo(AssetClassLabelComponent);
export const CurrencyBadge = memo(CurrencyBadgeComponent);
