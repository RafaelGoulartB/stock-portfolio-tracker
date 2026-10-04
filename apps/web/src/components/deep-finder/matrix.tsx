import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type AssetClass,
  DEEP_FINDER_WINDOWS,
  type DeepFinderWindow,
} from "@portifolio-tracker/shared";
import { ArrowDown, ArrowUp } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  HeatLegend,
  SortableHead,
  type SortDirection,
} from "@/components/analysis/primitives";
import { AssetClassLabel, assetClassText } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { sumDecimalStrings } from "@/components/detailed-positions/decimal-sum";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatCompactMoney,
  formatMoney,
  formatSignedPercent,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import { heatTint } from "@/lib/heat";
import { cn } from "@/lib/utils";
import {
  type FinderCurrency,
  percentOf,
  signedOrZero,
  WINDOW_HEAT_CAP,
  type WindowSummary,
  type WindowsRow,
  windowShortLabel,
} from "./types";

export type MatrixSortKey = "ticker" | "value" | "weight" | DeepFinderWindow;
export type MatrixSort = { key: MatrixSortKey; direction: SortDirection };
type Direction = "all" | "up" | "down";
type Unit = "percent" | "money";

const ALL_CLASSES = "all";

function sortValue(row: WindowsRow, key: MatrixSortKey): number | null {
  if (key === "value") {
    return row.marketValue == null ? null : Number(row.marketValue);
  }

  if (key === "weight") {
    return row.weight == null ? null : Number(row.weight);
  }

  return key === "ticker" ? null : percentOf(row, key);
}

function signedCompact(value: string, currency: FinderCurrency): string {
  const amount = Number(value);
  const formatted = formatCompactMoney(amount, currency);

  return amount > 0 ? `+${formatted}` : formatted;
}

/**
 * Every holding against every window, so a fall that is only today's
 * noise reads differently from one that has lasted all quarter.
 */
export function HoldingsMatrix({
  rows,
  windows,
  window,
  sort,
  onSort,
  missing,
}: {
  rows: WindowsRow[];
  windows: WindowSummary[];
  window: DeepFinderWindow;
  sort: MatrixSort;
  onSort: (sort: MatrixSort) => void;
  missing: string[];
}) {
  const { i18n } = useLingui();
  const [assetClass, setAssetClass] = useState<AssetClass | typeof ALL_CLASSES>(
    ALL_CLASSES,
  );
  const [direction, setDirection] = useState<Direction>("all");
  const [unit, setUnit] = useState<Unit>("percent");
  const currency = rows[0]?.displayCurrency ?? "BRL";
  const classes = useMemo(
    () => [...new Set(rows.map((row) => row.assetClass))],
    [rows],
  );
  const missingSet = useMemo(() => new Set(missing), [missing]);
  const summaryByWindow = useMemo(
    () => new Map(windows.map((entry) => [entry.window, entry.summary])),
    [windows],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter((row) => {
      if (assetClass !== ALL_CLASSES && row.assetClass !== assetClass) {
        return false;
      }

      if (direction === "all") {
        return true;
      }

      const move = percentOf(row, window);

      return move != null && (direction === "up" ? move > 0 : move < 0);
    });
    const sign = sort.direction === "asc" ? 1 : -1;

    return filtered.sort((a, b) => {
      if (sort.key === "ticker") {
        return sign * a.ticker.localeCompare(b.ticker, i18n.locale);
      }

      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);

      if (left == null || right == null) {
        if (left == null && right == null) {
          return a.ticker.localeCompare(b.ticker, i18n.locale);
        }

        return left == null ? 1 : -1;
      }

      return left === right
        ? a.ticker.localeCompare(b.ticker, i18n.locale)
        : sign * (left - right);
    });
  }, [rows, assetClass, direction, window, sort, i18n.locale]);

  const filteredView = assetClass !== ALL_CLASSES || direction !== "all";

  function toggle(key: MatrixSortKey) {
    if (sort.key === key) {
      onSort({ key, direction: sort.direction === "asc" ? "desc" : "asc" });
      return;
    }

    onSort({ key, direction: key === "ticker" ? "asc" : "desc" });
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="space-y-1.5">
          <CardTitle>
            <Trans id="deepFinder.matrixTitle">Holdings across windows</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="deepFinder.matrixHint">
              Color shows the percent move, scaled to each window. Select a
              column to rank by it. Period windows convert both ends at today's
              USD/BRL, so they show the price move; Cost includes FX.
            </Trans>
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={assetClass}
            onValueChange={(value) =>
              setAssetClass(value as AssetClass | typeof ALL_CLASSES)
            }
          >
            <SelectTrigger
              size="sm"
              className="w-[168px]"
              aria-label={i18n._(
                t({ id: "deepFinder.classFilter", message: "Category" }),
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CLASSES}>
                <Trans id="deepFinder.allClasses">All categories</Trans>
              </SelectItem>
              {classes.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  {assetClassText(entry, i18n)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={direction}
            onValueChange={(value) => value && setDirection(value as Direction)}
            aria-label={i18n._(
              t({ id: "deepFinder.directionFilter", message: "Direction" }),
            )}
          >
            <ToggleGroupItem value="all" className="px-3">
              <Trans id="deepFinder.filterAll">All</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="up" className="px-3">
              <ArrowUp aria-hidden="true" />
              <Trans id="deepFinder.filterUp">Rising</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="down" className="px-3">
              <ArrowDown aria-hidden="true" />
              <Trans id="deepFinder.filterDown">Falling</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={unit}
            onValueChange={(value) => value && setUnit(value as Unit)}
            aria-label={i18n._(
              t({ id: "deepFinder.unit", message: "Show values as" }),
            )}
          >
            <ToggleGroupItem value="percent" className="px-3">
              %
            </ToggleGroupItem>
            <ToggleGroupItem value="money" className="px-3">
              {currency === "BRL" ? "R$" : "US$"}
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="ml-auto hidden md:block">
            <HeatLegend cap={WINDOW_HEAT_CAP[window]} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <Table className="[&_tbody_td]:h-12 [&_td]:px-2 [&_th]:px-2">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortableHead
                label={<Trans id="deepFinder.colTicker">Ticker</Trans>}
                active={sort.key === "ticker"}
                direction={sort.direction}
                onToggle={() => toggle("ticker")}
                className="sticky left-0 z-10 bg-card pl-4 sm:pl-2"
              />
              <SortableHead
                label={<Trans id="deepFinder.colValue">Value</Trans>}
                active={sort.key === "value"}
                direction={sort.direction}
                align="right"
                onToggle={() => toggle("value")}
              />
              <SortableHead
                label={<Trans id="deepFinder.colWeight">Weight</Trans>}
                active={sort.key === "weight"}
                direction={sort.direction}
                align="right"
                onToggle={() => toggle("weight")}
                className="hidden sm:table-cell"
              />
              {DEEP_FINDER_WINDOWS.map((entry) => (
                <SortableHead
                  key={entry}
                  label={windowShortLabel(entry)}
                  active={sort.key === entry}
                  direction={sort.direction}
                  align="right"
                  onToggle={() => toggle(entry)}
                  className={cn(
                    "min-w-[4.75rem]",
                    entry === window && "bg-muted/60 text-foreground",
                  )}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.ticker}>
                <TableCell className="sticky left-0 z-10 bg-card pl-4 sm:pl-2">
                  <div className="flex items-center gap-2.5">
                    <AssetLogo
                      ticker={row.ticker}
                      assetClass={row.assetClass}
                      currency={row.currency}
                    />
                    <div className="min-w-0 leading-tight">
                      <AssetLink ticker={row.ticker} className="font-medium">
                        {row.ticker}
                      </AssetLink>
                      <p className="truncate text-xs text-muted-foreground">
                        <AssetClassLabel assetClass={row.assetClass} />
                        {missingSet.has(row.ticker) &&
                        row.assetClass !== "fixed_income" ? (
                          <>
                            {" · "}
                            <Trans id="deepFinder.unquoted">No quote</Trans>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.marketValue
                    ? formatMoney(row.marketValue, row.displayCurrency)
                    : "—"}
                </TableCell>
                <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
                  {row.weight ? formatWeight(row.weight) : "—"}
                </TableCell>
                {DEEP_FINDER_WINDOWS.map((entry) => (
                  <MoveCell
                    key={entry}
                    row={row}
                    window={entry}
                    unit={unit}
                    selected={entry === window}
                  />
                ))}
              </TableRow>
            ))}
          </TableBody>
          {!filteredView ? (
            <TableFooter>
              <TableRow>
                <TableCell className="sticky left-0 z-10 bg-muted pl-4 font-medium sm:pl-2">
                  <Trans id="deepFinder.total">Portfolio</Trans>
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(
                    sumDecimalStrings(rows.map((row) => row.marketValue)),
                    currency,
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell" />
                {DEEP_FINDER_WINDOWS.map((entry) => {
                  const total = summaryByWindow.get(entry);

                  return (
                    <TableCell
                      key={entry}
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        total?.totalChangePercent
                          ? pnlClassName(total.totalChangePercent)
                          : "text-muted-foreground",
                      )}
                    >
                      {!total || total.comparable === 0
                        ? "—"
                        : unit === "money"
                          ? signedCompact(total.totalChange, currency)
                          : total.totalChangePercent
                            ? formatSignedPercent(total.totalChangePercent)
                            : "—"}
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
        {visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            <Trans id="deepFinder.noMatches">
              No holdings match this filter for the selected window.
            </Trans>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MoveCell({
  row,
  window,
  unit,
  selected,
}: {
  row: WindowsRow;
  window: DeepFinderWindow;
  unit: Unit;
  selected: boolean;
}) {
  const move = row.moves[window];
  const percent = percentOf(row, window);
  let content: ReactNode = "—";

  if (move.changePercent != null && move.change != null) {
    content =
      unit === "money"
        ? signedCompact(move.change, row.displayCurrency)
        : formatSignedPercent(move.changePercent);
  }

  return (
    <TableCell
      className={cn(
        "text-right tabular-nums",
        percent == null && "text-muted-foreground",
        selected && "font-semibold",
      )}
      style={{ backgroundColor: heatTint(percent, WINDOW_HEAT_CAP[window]) }}
      title={
        move.change != null
          ? `${windowLabelText(window)}: ${signedOrZero(move.change, row.displayCurrency)}`
          : undefined
      }
    >
      {content}
    </TableCell>
  );
}

/** Plain-text window name for a native tooltip. */
function windowLabelText(window: DeepFinderWindow): string {
  switch (window) {
    case "cost":
      return t({ id: "deepFinder.windowCost", message: "Vs cost" });
    case "1d":
      return t({ id: "deepFinder.window1d", message: "1 day" });
    case "1w":
      return t({ id: "deepFinder.window1w", message: "1 week" });
    case "1m":
      return t({ id: "deepFinder.window1m", message: "1 month" });
    case "3m":
      return t({ id: "deepFinder.window3m", message: "3 months" });
    case "ytd":
      return t({ id: "deepFinder.windowYtd", message: "YTD" });
    case "1y":
      return t({ id: "deepFinder.window1y", message: "1 year" });
  }
}
