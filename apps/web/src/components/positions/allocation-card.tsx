import type { I18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AssetClass,
  Category,
  Currency,
  PortfolioSummary,
  ValuedPosition,
} from "@portifolio-tracker/shared";
import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { assetClassText } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { trpc } from "@/lib/api";
import { formatCompactMoney, formatMoney, formatWeight } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ShareBar } from "./shared";

/** How the composition panel buckets the portfolio. */
type AllocationGroupBy = "class" | "currency" | "category";

/** Assets listed before the panel asks to be expanded. */
const COLLAPSED_ASSET_ROWS = 24;

/** Bucket holding every asset the user has not filed under a category. */
const UNCATEGORIZED = "uncategorized";

/** Stable theme colors keep each built-in bucket recognizable across views. */
const CLASS_GROUP_COLORS: Record<AssetClass, string> = {
  stock_br: "var(--chart-1)",
  stock_us: "var(--chart-2)",
  reit: "var(--chart-3)",
  etf: "var(--chart-4)",
  bdr: "var(--chart-5)",
  crypto: "var(--chart-6)",
  fixed_income: "var(--chart-7)",
  cash: "var(--chart-8)",
  other: "var(--chart-9)",
};

const CURRENCY_GROUP_COLORS: Record<Currency, string> = {
  BRL: "var(--chart-1)",
  USD: "var(--chart-2)",
};

type GroupRow = {
  key: string;
  label: string;
  /** CSS color of the bar. Categories carry the color the user picked. */
  color?: string;
  /** Share of quoted equity, `0`–`1`. */
  share: number;
  shareLabel: string;
  display: string;
  count: number;
  /** Row ids in the bucket, so hovering it can highlight the asset list. */
  assetIds: Set<string>;
};

type AssetRow = {
  /** Ticker and currency, matching the holdings table row identity. */
  id: string;
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  /** Share of quoted equity, `0`–`1`. */
  share: number;
  shareLabel: string;
  display: string;
};

/** Color used by a non-category bucket in the allocation panel. */
function builtInGroupColor(
  groupBy: Exclude<AllocationGroupBy, "category">,
  key: string,
): string {
  return groupBy === "class"
    ? CLASS_GROUP_COLORS[key as AssetClass]
    : CURRENCY_GROUP_COLORS[key as Currency];
}

/** Bucket name for the active grouping, as a plain string for the tile. */
function bucketLabel(
  position: ValuedPosition,
  groupBy: AllocationGroupBy,
  category: Category | undefined,
  i18n: I18n,
): string {
  if (groupBy === "class") {
    return assetClassText(position.assetClass, i18n);
  }

  if (groupBy === "currency") {
    return position.currency;
  }

  return (
    category?.name ??
    i18n._(t({ id: "positions.allocUncategorized", message: "Uncategorized" }))
  );
}

/** Same row identity the holdings table uses: a ticker per currency. */
function assetRowId(position: ValuedPosition): string {
  return `${position.ticker}|${position.currency}`;
}

/** Heading and scale caption shared by both allocation sections. */
function PanelHeading({
  title,
  caption,
}: {
  title: ReactNode;
  caption: ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground/70">{caption}</p>
    </div>
  );
}

export function AllocationCard({
  positions,
  summary,
  snapshotLabel,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  snapshotLabel: string;
}) {
  const { i18n } = useLingui();
  const [groupBy, setGroupBy] = useState<AllocationGroupBy>("class");
  // `hovered` previews a bucket, `pinned` keeps it after the pointer leaves.
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const [pinned, setPinned] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);
  const activeGroup = hovered ?? pinned;

  // Categories are the user's own buckets; the tab only shows up once at
  // least one exists.
  const categoryList = trpc.categories.list.useQuery();
  const categories = categoryList.data?.categories ?? [];
  const categoryByTicker = useMemo(() => {
    const map = new Map<string, string>();

    for (const asset of categoryList.data?.assets ?? []) {
      if (asset.categoryId) {
        map.set(asset.ticker, asset.categoryId);
      }
    }

    return map;
  }, [categoryList.data?.assets]);

  // Falls back to classes when the last category is deleted elsewhere.
  const activeGroupBy: AllocationGroupBy =
    groupBy === "category" && categories.length === 0 ? "class" : groupBy;

  const quoted = useMemo(
    () => positions.filter((position) => position.convertedMarketValue != null),
    [positions],
  );

  const total = useMemo(
    () =>
      quoted.reduce(
        (sum, position) => sum + Number(position.convertedMarketValue ?? 0),
        0,
      ),
    [quoted],
  );

  const assets: AssetRow[] = useMemo(
    () =>
      quoted
        .map((position) => {
          const value = Number(position.convertedMarketValue ?? 0);
          const share =
            position.weight != null
              ? Number(position.weight)
              : total > 0
                ? value / total
                : 0;

          return {
            id: assetRowId(position),
            ticker: position.ticker,
            assetClass: position.assetClass,
            currency: position.currency,
            share,
            shareLabel: formatWeight(String(share)),
            display: formatCompactMoney(value, summary.displayCurrency),
          };
        })
        .sort((a, b) => b.share - a.share),
    [quoted, total, summary.displayCurrency],
  );

  const groups: GroupRow[] = useMemo(() => {
    const categoryById = new Map(
      categories.map((category) => [category.id, category]),
    );
    const buckets = new Map<
      string,
      {
        label: string;
        color?: string;
        value: number;
        count: number;
        assetIds: Set<string>;
      }
    >();

    for (const position of quoted) {
      const category =
        activeGroupBy === "category"
          ? categoryById.get(categoryByTicker.get(position.ticker) ?? "")
          : undefined;
      const key =
        activeGroupBy === "class"
          ? position.assetClass
          : activeGroupBy === "currency"
            ? position.currency
            : (category?.id ?? UNCATEGORIZED);
      const bucket = buckets.get(key) ?? {
        label: bucketLabel(position, activeGroupBy, category, i18n),
        // Categories wear the color the user picked; the residual bucket
        // stays neutral so it never reads as one of them.
        color:
          activeGroupBy === "category"
            ? (category && `var(--${category.color})`) ||
              "var(--muted-foreground)"
            : builtInGroupColor(activeGroupBy, key),
        value: 0,
        count: 0,
        assetIds: new Set<string>(),
      };

      bucket.value += Number(position.convertedMarketValue ?? 0);
      bucket.count += 1;
      bucket.assetIds.add(assetRowId(position));
      buckets.set(key, bucket);
    }

    return (
      [...buckets]
        .map(([key, bucket]) => {
          const share = total > 0 ? bucket.value / total : 0;

          return {
            key,
            label: bucket.label,
            color: bucket.color,
            share,
            shareLabel: formatWeight(String(share)),
            display: formatMoney(
              bucket.value.toFixed(2),
              summary.displayCurrency,
            ),
            count: bucket.count,
            assetIds: bucket.assetIds,
          };
        })
        // The residual bucket trails the real ones however big it is.
        .sort((a, b) => {
          if (a.key === UNCATEGORIZED || b.key === UNCATEGORIZED) {
            return a.key === UNCATEGORIZED ? 1 : -1;
          }

          return b.share - a.share;
        })
    );
  }, [
    quoted,
    activeGroupBy,
    categories,
    categoryByTicker,
    total,
    summary.displayCurrency,
    i18n,
  ]);

  // Clicking a bucket filters the list; hovering one only previews it, so the
  // rows never reflow under the pointer.
  const pinnedGroup = groups.find((group) => group.key === pinned);
  const previewedIds =
    !pinnedGroup && hovered
      ? groups.find((group) => group.key === hovered)?.assetIds
      : undefined;

  const listedAssets = pinnedGroup
    ? assets.filter((asset) => pinnedGroup.assetIds.has(asset.id))
    : assets;

  // Bars in the asset list are relative to the largest holding of the whole
  // portfolio: shares of the total are too small to compare at this scale, and
  // a fixed reference keeps a bar the same length whatever the filter is.
  const largestShare = assets[0]?.share ?? 0;
  const visibleAssets = expanded
    ? listedAssets
    : listedAssets.slice(0, COLLAPSED_ASSET_ROWS);

  // Keep the visual association between a group bar and every asset in it.
  const groupByAssetId = useMemo(() => {
    const result = new Map<string, Pick<GroupRow, "color">>();

    for (const group of groups) {
      for (const assetId of group.assetIds) {
        result.set(assetId, group);
      }
    }

    return result;
  }, [groups]);

  // CSS grid normally fills rows (left, right, left, right). Split the list
  // explicitly so descending values run down the left column, then continue
  // at the top of the right column.
  const assetColumns = useMemo(() => {
    const splitAt = Math.ceil(visibleAssets.length / 2);

    return [
      { key: "first", assets: visibleAssets.slice(0, splitAt) },
      { key: "second", assets: visibleAssets.slice(splitAt) },
    ];
  }, [visibleAssets]);

  const groupings: { id: AllocationGroupBy; label: ReactNode }[] = [
    { id: "class", label: <Trans id="positions.allocByClass">Class</Trans> },
    {
      id: "currency",
      label: <Trans id="positions.allocByCurrency">Currency</Trans>,
    },
    ...(categories.length > 0
      ? [
          {
            id: "category" as const,
            label: <Trans id="positions.allocByCategory">Category</Trans>,
          },
        ]
      : []),
  ];

  function toggleGroup(key: string) {
    setPinned((current) => (current === key ? undefined : key));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.allocation">Allocation</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.allocationHint">
            Market value at {snapshotLabel} and share of quoted equity.
          </Trans>
        </CardDescription>
        {quoted.length > 0 ? (
          <CardAction>
            <fieldset className="inline-flex rounded-lg border bg-muted/40 p-1">
              <legend className="sr-only">
                <Trans id="positions.allocGroupBy">Group by</Trans>
              </legend>
              {groupings.map((grouping) => (
                <Button
                  key={grouping.id}
                  type="button"
                  size="sm"
                  aria-pressed={activeGroupBy === grouping.id}
                  variant={activeGroupBy === grouping.id ? "default" : "ghost"}
                  className={cn(
                    activeGroupBy !== grouping.id && "text-muted-foreground",
                  )}
                  onClick={() => {
                    setGroupBy(grouping.id);
                    setPinned(undefined);
                  }}
                >
                  {grouping.label}
                </Button>
              ))}
            </fieldset>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {quoted.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <Trans id="positions.noQuotes">
              No market quotes for this snapshot yet.
            </Trans>
          </p>
        ) : (
          <div className="space-y-7">
            <section className="space-y-3">
              <PanelHeading
                title={
                  activeGroupBy === "class" ? (
                    <Trans id="positions.allocGroupsClass">By class</Trans>
                  ) : activeGroupBy === "currency" ? (
                    <Trans id="positions.allocGroupsCurrency">
                      By currency
                    </Trans>
                  ) : (
                    <Trans id="positions.allocGroupsCategory">
                      By category
                    </Trans>
                  )
                }
                caption={
                  <Trans id="positions.allocGroupsCaption">
                    Share of quoted equity.
                  </Trans>
                }
              />
              {/* Auto-fit keeps the row full whatever the bucket count is. The
                  negative margin lets the hover surface bleed out so labels
                  still line up with the heading. */}
              <ul className="-mx-2 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-x-10 gap-y-2">
                {groups.map((group) => (
                  <li key={group.key}>
                    <button
                      type="button"
                      className={cn(
                        "w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60",
                        pinned === group.key && "bg-muted/60",
                        activeGroup && activeGroup !== group.key
                          ? "opacity-40"
                          : "",
                      )}
                      aria-pressed={pinned === group.key}
                      onClick={() => toggleGroup(group.key)}
                      onMouseEnter={() => setHovered(group.key)}
                      onMouseLeave={() => setHovered(undefined)}
                      onFocus={() => setHovered(group.key)}
                      onBlur={() => setHovered(undefined)}
                    >
                      <span className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="truncate font-medium">
                          {group.label}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums">
                          {group.shareLabel}
                        </span>
                      </span>
                      <ShareBar
                        className="mt-1.5"
                        color={group.color}
                        fraction={group.share}
                      />
                      <span className="mt-1 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {i18n._(
                            t({
                              id: "positions.allocGroupCount",
                              message: plural(
                                { count: group.count },
                                { one: "# asset", other: "# assets" },
                              ),
                            }),
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {group.display}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="space-y-3 border-t pt-6">
              <PanelHeading
                title={
                  <Trans id="positions.allocAssets">
                    By asset · {listedAssets.length}
                  </Trans>
                }
                caption={
                  <Trans id="positions.allocAssetsCaption">
                    Bars relative to the largest position.
                  </Trans>
                }
              />
              {/* Two columns at most: a third one starves the bars. */}
              <div className="-mx-2 grid gap-x-8 md:grid-cols-2">
                {assetColumns.map((column) => (
                  <ul key={column.key} className="space-y-0.5">
                    {column.assets.map((asset) => {
                      const group = groupByAssetId.get(asset.id);

                      return (
                        <li
                          key={asset.id}
                          className={cn(
                            "flex items-center gap-2.5 rounded-md px-2 py-1 text-sm transition-opacity",
                            previewedIds && !previewedIds.has(asset.id)
                              ? "opacity-30"
                              : "",
                          )}
                        >
                          <AssetLogo
                            ticker={asset.ticker}
                            assetClass={asset.assetClass}
                            currency={asset.currency}
                            className="size-6 shrink-0 rounded-sm"
                          />
                          <div className="w-[76px] shrink-0">
                            <AssetLink
                              ticker={asset.ticker}
                              className="block truncate font-medium"
                              title={asset.ticker}
                            >
                              {asset.ticker}
                            </AssetLink>
                          </div>
                          <ShareBar
                            className="min-w-8 flex-1"
                            color={group?.color}
                            fraction={
                              largestShare > 0 ? asset.share / largestShare : 0
                            }
                          />
                          <span className="w-11 shrink-0 text-right tabular-nums">
                            {asset.shareLabel}
                          </span>
                          {/* The amount is a bonus: it only shows where the bar can
                              spare the width, and the holdings table always has it. */}
                          <span className="hidden w-20 shrink-0 text-right text-muted-foreground tabular-nums xl:block">
                            {asset.display}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ))}
              </div>
              {listedAssets.length > COLLAPSED_ASSET_ROWS ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setExpanded((current) => !current)}
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="size-4" aria-hidden="true" />
                      <Trans id="positions.allocShowLess">Show fewer</Trans>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="size-4" aria-hidden="true" />
                      <Trans id="positions.allocShowAll">
                        Show all {listedAssets.length}
                      </Trans>
                    </>
                  )}
                </Button>
              ) : null}
            </section>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
