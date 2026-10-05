import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { Category } from "@portifolio-tracker/shared";
import { type ReactNode, useState } from "react";
import { DivergingBar } from "@/components/analysis/primitives";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { trpc } from "@/lib/api";
import {
  formatCompactMoney,
  formatMoney,
  formatSignedPercentPrecise,
  pnlClassName,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type DailyData,
  type DailyPosition,
  marketPositions,
  signedOrZero,
} from "./types";

const MOVER_LIMIT = 3;

/** Category rows in the user's order; uncategorized holdings come last. */
function categoryRows(
  entries: DailyData["summary"]["byCategory"],
  categories: readonly Category[],
  i18n: I18n,
): BreakdownRow[] {
  const byId = new Map(entries.map((entry) => [entry.categoryId, entry]));
  const rows: BreakdownRow[] = categories.flatMap((category) => {
    const entry = byId.get(category.id);

    return entry
      ? [
          {
            ...entry,
            key: category.id,
            label: category.name,
            color: `var(--${category.color})`,
          },
        ]
      : [];
  });
  const uncategorized = byId.get(null);

  if (uncategorized) {
    rows.push({
      ...uncategorized,
      key: "uncategorized",
      label: i18n._(
        t({ id: "positions.allocUncategorized", message: "Uncategorized" }),
      ),
      color: "var(--muted-foreground)",
    });
  }

  return rows;
}

type BreakdownGroupBy = "class" | "category";

type BreakdownRow = {
  key: string;
  label: ReactNode;
  /** CSS color of a category's dot; classes have none. */
  color?: string;
  marketValue: string;
  dailyChange: string | null;
  dailyChangePercent: string | null;
};

/**
 * Day move per asset class or per user category, and how much of it the
 * dollar explains.
 */
export function ClassBreakdown({ data }: { data: DailyData }) {
  const { i18n } = useLingui();
  const { summary } = data;
  const currency = summary.displayCurrency;
  // Categories are the user's own buckets; they become the default as soon
  // as one exists, and the toggle only shows up then.
  const categoryList = trpc.categories.list.useQuery();
  const categories = categoryList.data?.categories ?? [];
  const [groupBy, setGroupBy] = useState<BreakdownGroupBy | null>(null);
  const activeGroupBy: BreakdownGroupBy =
    categories.length === 0 ? "class" : (groupBy ?? "category");

  const rows: BreakdownRow[] =
    activeGroupBy === "class"
      ? summary.byAssetClass
          .filter(
            (entry) =>
              entry.assetClass !== "cash" || Number(entry.marketValue) !== 0,
          )
          .map((entry) => ({
            ...entry,
            key: entry.assetClass,
            label: <AssetClassLabel assetClass={entry.assetClass} />,
          }))
      : categoryRows(summary.byCategory, categories, i18n);
  const largest = Math.max(
    0,
    ...rows.map((entry) => Math.abs(Number(entry.dailyChange ?? 0))),
  );
  const showSplit =
    summary.dailyFxChange != null && summary.dailyPriceChange != null;

  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <CardTitle>
          {activeGroupBy === "class" ? (
            <Trans id="daily.breakdownClassTitle">By asset class</Trans>
          ) : (
            <Trans id="daily.breakdownCategoryTitle">By category</Trans>
          )}
        </CardTitle>
        {categories.length > 0 ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={activeGroupBy}
            onValueChange={(value) => {
              if (value) {
                setGroupBy(value as BreakdownGroupBy);
              }
            }}
            aria-label={i18n._(
              t({ id: "positions.allocGroupBy", message: "Group by" }),
            )}
          >
            <ToggleGroupItem value="category" className="h-7 px-2 text-xs">
              <Trans id="positions.allocByCategory">Category</Trans>
            </ToggleGroupItem>
            <ToggleGroupItem value="class" className="h-7 px-2 text-xs">
              <Trans id="positions.allocByClass">Class</Trans>
            </ToggleGroupItem>
          </ToggleGroup>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-3">
          {rows.map((entry) => (
            <li key={entry.key} className="space-y-1.5">
              <div className="flex items-baseline gap-2 text-sm">
                {entry.color ? (
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 self-center rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                ) : null}
                <span className="min-w-0 truncate font-medium">
                  {entry.label}
                </span>
                <span
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                  title={formatMoney(entry.marketValue, currency)}
                >
                  {formatCompactMoney(Number(entry.marketValue), currency)}
                </span>
                <span
                  className={cn(
                    "ml-auto shrink-0 tabular-nums",
                    entry.dailyChange == null
                      ? "text-muted-foreground"
                      : pnlClassName(entry.dailyChange),
                  )}
                >
                  {entry.dailyChange == null
                    ? "—"
                    : signedOrZero(entry.dailyChange, currency)}
                </span>
                <span
                  className={cn(
                    "w-14 text-right text-xs tabular-nums",
                    entry.dailyChangePercent
                      ? pnlClassName(entry.dailyChangePercent)
                      : "text-muted-foreground",
                  )}
                >
                  {entry.dailyChangePercent
                    ? formatSignedPercentPrecise(entry.dailyChangePercent)
                    : "—"}
                </span>
              </div>
              <DivergingBar
                value={
                  entry.dailyChange == null ? null : Number(entry.dailyChange)
                }
                max={largest}
              />
            </li>
          ))}
        </ul>

        {showSplit ? (
          <>
            <Separator />
            <dl className="space-y-1.5 text-sm">
              <SplitRow
                label={<Trans id="daily.priceEffect">Price move</Trans>}
                value={summary.dailyPriceChange ?? "0"}
                currency={currency}
              />
              <SplitRow
                label={<Trans id="daily.fxEffectLabel">Dollar move</Trans>}
                value={summary.dailyFxChange ?? "0"}
                currency={currency}
              />
            </dl>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SplitRow({
  label,
  value,
  currency,
}: {
  label: ReactNode;
  value: string;
  currency: DailyData["summary"]["displayCurrency"];
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium tabular-nums", pnlClassName(value))}>
        {signedOrZero(value, currency)}
      </dd>
    </div>
  );
}

/** The few assets that moved the portfolio most, in money, each way. */
export function BiggestMovers({
  data,
  className,
}: {
  data: DailyData;
  className?: string;
}) {
  const compared = marketPositions(data).filter(
    (position) => position.dailyChange != null,
  );
  const sorted = [...compared].sort(
    (a, b) => Number(b.dailyChange) - Number(a.dailyChange),
  );
  const up = sorted
    .filter((position) => Number(position.dailyChange) > 0)
    .slice(0, MOVER_LIMIT);
  const down = sorted
    .filter((position) => Number(position.dailyChange) < 0)
    .slice(-MOVER_LIMIT)
    .reverse();

  if (up.length === 0 && down.length === 0) {
    return null;
  }

  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader>
        <CardTitle>
          <Trans id="daily.moversTitle">Biggest impact</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <MoverList
          positions={up}
          empty={<Trans id="daily.noRisers">No asset rose today.</Trans>}
        />
        <Separator />
        <MoverList
          positions={down}
          empty={<Trans id="daily.noFallers">No asset fell today.</Trans>}
        />
      </CardContent>
    </Card>
  );
}

function MoverList({
  positions,
  empty,
}: {
  positions: DailyPosition[];
  empty: ReactNode;
}) {
  if (positions.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }

  return (
    <ul className="space-y-2">
      {positions.map((position) => (
        <li key={position.ticker} className="flex items-center gap-2.5 text-sm">
          <AssetLogo
            ticker={position.ticker}
            assetClass={position.assetClass}
            currency={position.currency}
          />
          <AssetLink ticker={position.ticker} className="font-medium">
            {position.ticker}
          </AssetLink>
          <span
            className={cn(
              "ml-auto tabular-nums",
              pnlClassName(position.dailyChange ?? "0"),
            )}
          >
            {signedOrZero(
              position.dailyChange ?? "0",
              position.displayCurrency,
            )}
          </span>
          <span
            className={cn(
              "w-14 text-right text-xs tabular-nums",
              pnlClassName(position.dailyChangePercent ?? "0"),
            )}
          >
            {position.dailyChangePercent
              ? formatSignedPercentPrecise(position.dailyChangePercent)
              : "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
