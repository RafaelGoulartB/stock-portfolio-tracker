import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatMoney,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  formatSignedWeightPrecise,
  formatTradeDate,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { sumDecimalStrings } from "./decimal-sum";
import {
  COLUMN_IDS,
  type ColumnId,
  type DetailedPosition,
  type PositionsSummary,
  type SortState,
} from "./types";

type Totals = {
  invested: string;
  market: string;
  unrealized: string;
  fx: string;
  portfolioReturn: string | null;
  realized: string;
  weight: string;
};

/** Columns holding words, aligned left; every other column is a number. */
const TEXT_COLUMNS = new Set<ColumnId>(["ticker", "assetClass", "currency"]);

/**
 * Totals reflect the *filtered* rows currently on screen, not the whole
 * portfolio. Money columns are summed exactly from the row decimal strings via
 * {@link sumDecimalStrings} — never `Number` — so filtering never introduces
 * float drift. Open-position money (invested, market value, open result) sums
 * only rows with a live quantity; realized P&L includes closed rows too. The
 * portfolio return percentage stays the authoritative value the API computed
 * for the selection. The weight column sums the visible rows, so a filtered
 * view shows the share of the portfolio it covers.
 */
function computeTotals(
  rows: DetailedPosition[],
  portfolioReturn: string | null,
): Totals {
  const openRows = rows.filter((position) => Number(position.quantity) > 0);
  return {
    invested: sumDecimalStrings(
      openRows.map((row) => row.convertedInvestedCost),
    ),
    market: sumDecimalStrings(openRows.map((row) => row.convertedMarketValue)),
    unrealized: sumDecimalStrings(
      openRows.map((row) => row.convertedUnrealizedPnl),
    ),
    fx: sumDecimalStrings(openRows.map((row) => row.convertedFxPnl)),
    portfolioReturn,
    realized: sumDecimalStrings(rows.map((row) => row.convertedRealizedPnl)),
    weight: sumDecimalStrings(
      openRows.map((row) => row.weight),
      8,
    ),
  };
}

export function PositionsTable({
  rows,
  visibleColumns,
  labels,
  sort,
  onSort,
  displayCurrency,
  summary,
  missing,
}: {
  rows: DetailedPosition[];
  visibleColumns: Set<ColumnId>;
  labels: Record<ColumnId, string>;
  sort: SortState;
  onSort: (id: ColumnId) => void;
  displayCurrency: "BRL" | "USD";
  summary: PositionsSummary;
  missing: string[];
}) {
  const { i18n } = useLingui();
  const columns = COLUMN_IDS.filter((id) => visibleColumns.has(id));
  const totals = computeTotals(rows, summary.totalUnrealizedPnlPercent);

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <Table className="text-[13px] leading-5">
          <TableHeader className="bg-muted/60">
            <TableRow className="hover:bg-transparent">
              {columns.map((id) => (
                <TableHead
                  key={id}
                  className={`${id === "ticker" ? "sticky left-0 z-10 bg-muted" : ""} h-10 px-3`}
                  aria-sort={
                    sort.id === id
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => onSort(id)}
                    className={`flex w-full items-center gap-1 font-medium ${TEXT_COLUMNS.has(id) ? "text-left" : "flex-row-reverse text-right"}`}
                    aria-label={i18n._(
                      t({
                        id: "detailedPositions.sortBy",
                        message: `Sort by ${labels[id]}`,
                      }),
                    )}
                  >
                    {labels[id]}
                    {sort.id === id ? (
                      sort.direction === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      )
                    ) : (
                      <ArrowUpDown className="size-3 opacity-40" />
                    )}
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((position) => (
              <TableRow
                key={`${position.ticker}|${position.currency}`}
                className="h-11"
              >
                {columns.map((id) => (
                  <PositionCell
                    key={id}
                    id={id}
                    position={position}
                    missing={missing.includes(position.ticker)}
                  />
                ))}
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-28 text-center text-sm text-muted-foreground"
                >
                  <Trans id="detailedPositions.empty">
                    No positions match these filters.
                  </Trans>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          {rows.length > 0 ? (
            <TableFooter>
              <TableRow>
                {columns.map((id, index) => (
                  <TableCell
                    key={id}
                    className="px-3 py-2 text-right tabular-nums"
                  >
                    {index === 0 ? (
                      <span className="block text-left">
                        <Trans id="positions.total">Total</Trans>
                      </span>
                    ) : (
                      totalForColumn(id, totals, displayCurrency)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </CardContent>
      <div className="border-t px-4 py-2 text-xs text-muted-foreground">
        <Trans id="detailedPositions.rowCount">
          {rows.length} positions · {columns.length} columns
        </Trans>
      </div>
    </Card>
  );
}

function PositionCell({
  id,
  position,
  missing,
}: {
  id: ColumnId;
  position: DetailedPosition;
  missing: boolean;
}) {
  const { i18n } = useLingui();
  let content: ReactNode;
  switch (id) {
    case "ticker":
      content = (
        <AssetLink
          ticker={position.ticker}
          className="flex items-center gap-2 font-semibold"
        >
          <AssetLogo
            ticker={position.ticker}
            assetClass={position.assetClass}
            currency={position.currency}
          />
          {position.ticker}
        </AssetLink>
      );
      break;
    case "assetClass":
      content = <AssetClassLabel assetClass={position.assetClass} />;
      break;
    case "currency":
      content = position.currency;
      break;
    case "quantity":
      content =
        position.assetClass === "cash" ? (
          <Dash />
        ) : (
          formatQuantity(position.quantity)
        );
      break;
    case "averagePrice":
      content = formatMoney(position.averagePrice, position.currency);
      break;
    case "investedCost":
      content = formatMoney(
        position.convertedInvestedCost,
        position.displayCurrency,
      );
      break;
    case "marketPrice":
      content =
        position.marketPrice == null ? (
          <Dash missing={missing} />
        ) : (
          formatMoney(position.marketPrice, position.currency)
        );
      break;
    case "marketValue":
      content =
        position.convertedMarketValue == null ? (
          <Dash missing={missing} />
        ) : (
          formatMoney(position.convertedMarketValue, position.displayCurrency)
        );
      break;
    case "unrealizedPnl":
      content =
        position.convertedUnrealizedPnl == null ? (
          <Dash missing={missing} />
        ) : (
          <span className={pnlClassName(position.convertedUnrealizedPnl)}>
            {formatSignedMoney(
              position.convertedUnrealizedPnl,
              position.displayCurrency,
            )}
          </span>
        );
      break;
    case "fxPnl":
      // Same-currency rows have no FX component, which is not a missing quote.
      content =
        position.convertedFxPnl == null ? (
          <Dash
            missing={missing && position.currency !== position.displayCurrency}
          />
        ) : (
          <span
            className={pnlClassName(position.convertedFxPnl)}
            title={
              position.tradesMissingFx > 0
                ? i18n._(
                    t({
                      id: "detailedPositions.fxPending",
                      message:
                        "Some trades have no trade-date USD/BRL yet and convert at today's rate.",
                    }),
                  )
                : undefined
            }
          >
            {formatSignedMoney(
              position.convertedFxPnl,
              position.displayCurrency,
            )}
            {position.tradesMissingFx > 0 ? "*" : null}
          </span>
        );
      break;
    case "unrealizedPnlPercent":
      content =
        position.convertedUnrealizedPnlPercent == null ? (
          <Dash missing={missing} />
        ) : (
          <span
            className={pnlClassName(position.convertedUnrealizedPnlPercent)}
          >
            {formatSignedPercent(position.convertedUnrealizedPnlPercent)}
          </span>
        );
      break;
    case "returnContribution":
      content =
        position.returnContribution == null ? (
          <Dash />
        ) : (
          <span className={pnlClassName(position.returnContribution)}>
            {formatSignedWeightPrecise(position.returnContribution)}
          </span>
        );
      break;
    case "weight":
      content =
        position.weight == null ? (
          <Dash missing={missing} />
        ) : (
          formatWeight(position.weight)
        );
      break;
    case "realizedPnl":
      content = (
        <span className={pnlClassName(position.convertedRealizedPnl)}>
          {formatSignedMoney(
            position.convertedRealizedPnl,
            position.displayCurrency,
          )}
        </span>
      );
      break;
    case "transactionCount":
      content = position.transactionCount;
      break;
    case "lastTradedAt":
      content = formatTradeDate(position.lastTradedAt);
      break;
    case "quoteAsOf":
      content = position.quoteAsOf ? (
        formatTradeDate(position.quoteAsOf)
      ) : (
        <Dash missing={missing} />
      );
      break;
  }
  return (
    <TableCell
      className={`${id === "ticker" ? "sticky left-0 z-10 bg-card" : ""} ${TEXT_COLUMNS.has(id) ? "text-left" : "text-right"} px-3 py-2 tabular-nums`}
    >
      {content}
    </TableCell>
  );
}

export function Dash({ missing = false }: { missing?: boolean }) {
  const { i18n } = useLingui();
  return (
    <span
      className={missing ? "text-caution" : "text-muted-foreground"}
      title={
        missing
          ? i18n._(
              t({
                id: "detailedPositions.quoteUnavailable",
                message: "Market quote unavailable",
              }),
            )
          : undefined
      }
    >
      —
    </span>
  );
}

function totalForColumn(id: ColumnId, totals: Totals, currency: "BRL" | "USD") {
  if (id === "investedCost") return formatMoney(totals.invested, currency);
  if (id === "marketValue") return formatMoney(totals.market, currency);
  if (id === "unrealizedPnl")
    return (
      <span className={pnlClassName(totals.unrealized)}>
        {formatSignedMoney(totals.unrealized, currency)}
      </span>
    );
  if (id === "fxPnl")
    return (
      <span className={pnlClassName(totals.fx)}>
        {formatSignedMoney(totals.fx, currency)}
      </span>
    );
  if (id === "unrealizedPnlPercent" || id === "returnContribution")
    return totals.portfolioReturn == null ? (
      <Dash />
    ) : (
      <span className={pnlClassName(totals.portfolioReturn)}>
        {id === "unrealizedPnlPercent"
          ? formatSignedPercent(totals.portfolioReturn)
          : formatSignedWeightPrecise(totals.portfolioReturn)}
      </span>
    );
  if (id === "realizedPnl")
    return (
      <span className={pnlClassName(totals.realized)}>
        {formatSignedMoney(totals.realized, currency)}
      </span>
    );
  if (id === "weight") return formatWeight(totals.weight);
  return null;
}
