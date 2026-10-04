import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { AssetClassLabel } from "@/components/asset-labels";
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
  formatSignedPercent,
  formatWeight,
  pnlClassName,
} from "@/lib/format";
import {
  type Category,
  type ClassBreakdown,
  type PerformanceSummary,
  signedOrZero,
} from "./types";

export function CategoryTable({
  breakdown,
  summary,
  categories,
}: {
  breakdown: ClassBreakdown[];
  summary: PerformanceSummary;
  categories: Category[];
}) {
  const currency = summary.displayCurrency;
  const colorByClass = useMemo(
    () =>
      new Map(
        categories.map((category) => [category.assetClass, category.color]),
      ),
    [categories],
  );

  return (
    <Table className="[&_tbody_td]:h-11 [&_tfoot_td]:h-11">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="text-muted-foreground">
            <Trans id="performance.colCategory">Category</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colAssets">Assets</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colInvested">Cost basis</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colValue">Value</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colWeight">Weight</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colOpenResult">Open result</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colReturn">Return</Trans>
          </TableHead>
          <TableHead className="text-right text-muted-foreground">
            <Trans id="performance.colContribution">Contribution</Trans>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {breakdown.map((entry) => (
          <TableRow key={entry.assetClass}>
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      colorByClass.get(entry.assetClass) ??
                      "var(--muted-foreground)",
                  }}
                  aria-hidden="true"
                />
                <AssetClassLabel assetClass={entry.assetClass} />
              </span>
            </TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">
              {entry.positions}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatMoney(entry.investedCost, currency)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(entry.marketValue, currency)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground tabular-nums">
              <div className="flex items-center justify-end gap-2">
                {entry.weight == null ? null : (
                  <span
                    aria-hidden="true"
                    className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted md:block"
                  >
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.min(Number(entry.weight), 1) * 100}%`,
                        backgroundColor:
                          colorByClass.get(entry.assetClass) ??
                          "var(--muted-foreground)",
                      }}
                    />
                  </span>
                )}
                <span className="w-12">
                  {entry.weight == null ? "—" : formatWeight(entry.weight)}
                </span>
              </div>
            </TableCell>
            <TableCell
              className={`text-right tabular-nums ${pnlClassName(entry.unrealizedPnl)}`}
            >
              {signedOrZero(entry.unrealizedPnl, currency)}
            </TableCell>
            <TableCell
              className={`text-right tabular-nums ${entry.unrealizedPnlPercent == null ? "" : pnlClassName(entry.unrealizedPnlPercent)}`}
            >
              {entry.unrealizedPnlPercent == null
                ? "—"
                : formatSignedPercent(entry.unrealizedPnlPercent)}
            </TableCell>
            <TableCell
              className={`text-right tabular-nums ${entry.contribution == null ? "" : pnlClassName(entry.contribution)}`}
            >
              {entry.contribution == null
                ? "—"
                : formatSignedPercent(entry.contribution)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2} className="font-medium">
            <Trans id="performance.total">Portfolio</Trans>
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatMoney(summary.investedCost, currency)}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatMoney(summary.currentValue, currency)}
          </TableCell>
          <TableCell />
          <TableCell
            className={`text-right font-semibold tabular-nums ${pnlClassName(summary.unrealizedPnl)}`}
          >
            {signedOrZero(summary.unrealizedPnl, currency)}
          </TableCell>
          <TableCell
            className={`text-right font-semibold tabular-nums ${summary.unrealizedPnlPercent == null ? "" : pnlClassName(summary.unrealizedPnlPercent)}`}
          >
            {summary.unrealizedPnlPercent == null
              ? "—"
              : formatSignedPercent(summary.unrealizedPnlPercent)}
          </TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}
