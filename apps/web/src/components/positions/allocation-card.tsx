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
import { type ReactNode, useMemo, useState } from "react";
import { Cell, Pie, PieChart } from "recharts";
import { assetClassText } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChartContainer } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type RouterOutputs, trpc } from "@/lib/api";
import { ASSET_CLASS_COLORS } from "@/lib/asset-class-colors";
import {
  formatCompactMoney,
  formatMoney,
  formatQuantity,
  formatWeight,
} from "@/lib/format";
import { cn } from "@/lib/utils";

type PortfolioConcentration = NonNullable<
  RouterOutputs["positions"]["list"]["concentration"]
>;

/** How the composition panel buckets the portfolio. */
type AllocationGroupBy = "class" | "currency" | "category";

/** Bucket holding every asset the user has not filed under a category. */
const UNCATEGORIZED = "uncategorized";

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

/** Color used by a non-category bucket in the allocation panel. */
function builtInGroupColor(
  groupBy: Exclude<AllocationGroupBy, "category">,
  key: string,
): string {
  return groupBy === "class"
    ? ASSET_CLASS_COLORS[key as AssetClass]
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

export type AllocationFilter = {
  /** Bucket key within the grouping that produced it. */
  key: string;
  label: string;
  /** Holdings-table row ids (`ticker|currency`) inside the bucket. */
  ids: Set<string>;
};

export function AllocationCard({
  positions,
  summary,
  snapshotLabel,
  concentration,
  filter,
  onFilterChange,
}: {
  positions: ValuedPosition[];
  summary: PortfolioSummary;
  snapshotLabel: string;
  concentration: PortfolioConcentration | null;
  filter: AllocationFilter | null;
  /** Selecting a bucket narrows the holdings table to it. */
  onFilterChange: (filter: AllocationFilter | null) => void;
}) {
  const { i18n } = useLingui();
  const [groupBy, setGroupBy] = useState<AllocationGroupBy>("class");
  // `hovered` previews a bucket; the pinned one filters the holdings.
  const [hovered, setHovered] = useState<string | undefined>(undefined);
  const pinned = filter?.key;
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
    () =>
      positions.filter(
        (position) =>
          position.convertedMarketValue != null &&
          Number(position.convertedMarketValue) !== 0,
      ),
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

  function pin(key: string | undefined) {
    const group = groups.find((entry) => entry.key === key);

    onFilterChange(
      group
        ? { key: group.key, label: group.label, ids: group.assetIds }
        : null,
    );
  }

  function toggleGroup(key: string) {
    pin(pinned === key ? undefined : key);
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64 space-y-1.5">
          <CardTitle>
            <Trans id="positions.allocation">Allocation</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="positions.allocationFilterHint">
              Market value at {snapshotLabel}. Select a slice to show only its
              assets in the holdings table.
            </Trans>
          </CardDescription>
        </div>
        {quoted.length > 0 ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={activeGroupBy}
            onValueChange={(value) => {
              if (!value) {
                return;
              }

              setGroupBy(value as AllocationGroupBy);
              onFilterChange(null);
            }}
            aria-label={i18n._(
              t({ id: "positions.allocGroupBy", message: "Group by" }),
            )}
          >
            {groupings.map((grouping) => (
              <ToggleGroupItem
                key={grouping.id}
                value={grouping.id}
                className="px-3"
              >
                {grouping.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
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
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <section className="grid items-center gap-6 sm:grid-cols-[180px_minmax(0,1fr)]">
              <AllocationDonut
                groups={groups}
                activeGroup={activeGroup}
                total={total}
                currency={summary.displayCurrency}
                count={quoted.length}
                onHover={setHovered}
                onToggle={toggleGroup}
              />
              <ul className="-mx-2 space-y-0.5">
                {groups.map((group) => (
                  <li key={group.key}>
                    <button
                      type="button"
                      className={cn(
                        "w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-[opacity,background-color] hover:bg-muted/60",
                        pinned === group.key && "bg-muted/60",
                        activeGroup && activeGroup !== group.key
                          ? "opacity-45"
                          : "",
                      )}
                      aria-pressed={pinned === group.key}
                      onClick={() => toggleGroup(group.key)}
                      onMouseEnter={() => setHovered(group.key)}
                      onMouseLeave={() => setHovered(undefined)}
                      onFocus={() => setHovered(group.key)}
                      onBlur={() => setHovered(undefined)}
                    >
                      <span className="flex items-center gap-2.5 text-sm">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: group.color }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate font-medium">
                          {group.label}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
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
                        <span className="ml-auto hidden shrink-0 text-muted-foreground tabular-nums sm:inline">
                          {group.display}
                        </span>
                        <span className="ml-auto w-12 shrink-0 text-right font-medium tabular-nums sm:ml-0">
                          {group.shareLabel}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            {concentration ? (
              <section className="border-t pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                <ConcentrationPanel concentration={concentration} />
              </section>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AllocationDonut({
  groups,
  activeGroup,
  total,
  currency,
  count,
  onHover,
  onToggle,
}: {
  groups: GroupRow[];
  activeGroup: string | undefined;
  total: number;
  currency: Currency;
  count: number;
  onHover: (key: string | undefined) => void;
  onToggle: (key: string) => void;
}) {
  const { i18n } = useLingui();
  const active = groups.find((group) => group.key === activeGroup);

  return (
    <div className="relative mx-auto size-[180px]">
      <ChartContainer config={{}} className="aspect-square size-full">
        <PieChart>
          <Pie
            data={groups}
            dataKey="share"
            nameKey="label"
            innerRadius={62}
            outerRadius={88}
            paddingAngle={groups.length > 1 ? 1.5 : 0}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
            onMouseEnter={(_, index) => onHover(groups[index]?.key)}
            onMouseLeave={() => onHover(undefined)}
            onClick={(_, index) => {
              const key = groups[index]?.key;

              if (key) {
                onToggle(key);
              }
            }}
          >
            {groups.map((group) => (
              <Cell
                key={group.key}
                fill={group.color}
                className="cursor-pointer outline-none"
                opacity={activeGroup && activeGroup !== group.key ? 0.3 : 1}
              />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="max-w-28 truncate text-xs text-muted-foreground">
          {active
            ? active.label
            : i18n._(
                t({
                  id: "positions.allocDonutTotal",
                  message: plural(
                    { count },
                    { one: "# asset", other: "# assets" },
                  ),
                }),
              )}
        </span>
        <span className="text-base font-semibold">
          {active ? active.shareLabel : formatCompactMoney(total, currency)}
        </span>
      </div>
    </div>
  );
}

function ConcentrationPanel({
  concentration,
}: {
  concentration: PortfolioConcentration;
}) {
  const { i18n } = useLingui();
  const top5 = Number(concentration.top5Weight);
  const top10 = Number(concentration.top10Weight);
  const segments = [
    { key: "top5", share: top5, color: "var(--chart-primary)" },
    {
      key: "next5",
      share: Math.max(top10 - top5, 0),
      color: "color-mix(in oklab, var(--chart-primary) 55%, var(--card))",
    },
    {
      key: "rest",
      share: Math.max(1 - top10, 0),
      color: "var(--muted)",
    },
  ].filter((segment) => segment.share > 0);
  const effective = formatQuantity(concentration.effectivePositions);
  const positionCount = concentration.positions;
  const half = concentration.halfOfValueIn;

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium">
          <Trans id="positions.concentration">Concentration</Trans>
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <Trans id="positions.concentrationHint">
            How much of the invested value depends on a few positions. Cash is
            left out.
          </Trans>
        </p>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <ConcentrationStat
          label={<Trans id="positions.largestPosition">Largest</Trans>}
          value={formatWeight(concentration.largest.weight)}
          hint={
            <AssetLink ticker={concentration.largest.ticker}>
              {concentration.largest.ticker}
            </AssetLink>
          }
        />
        <ConcentrationStat
          label={<Trans id="positions.top5">Top 5</Trans>}
          value={formatWeight(concentration.top5Weight)}
        />
        <ConcentrationStat
          label={<Trans id="positions.top10">Top 10</Trans>}
          value={formatWeight(concentration.top10Weight)}
        />
      </dl>

      <div className="space-y-1.5">
        <div
          className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
          aria-hidden="true"
        >
          {segments.map((segment) => (
            <span
              key={segment.key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${segment.share * 100}%`,
                backgroundColor: segment.color,
              }}
            />
          ))}
        </div>
        <p className="flex justify-between text-[11px] text-muted-foreground">
          <span>
            <Trans id="positions.top5Short">Top 5</Trans>
          </span>
          <span>
            <Trans id="positions.restShort">Everything else</Trans>
          </span>
        </p>
      </div>

      <div className="space-y-1.5 rounded-lg bg-muted/40 px-3 py-2.5 text-sm">
        <p>
          <Trans id="positions.effectivePositions">
            Behaves like <strong>{effective}</strong> equal-weight positions out
            of {positionCount}.
          </Trans>
        </p>
        <p className="text-muted-foreground">
          {i18n._(
            t({
              id: "positions.halfOfValue",
              message: plural(
                { count: half },
                {
                  one: "Half of the invested value is in the largest position.",
                  other:
                    "Half of the invested value is in the # largest positions.",
                },
              ),
            }),
          )}
        </p>
      </div>
    </div>
  );
}

function ConcentrationStat({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: string;
  hint?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{value}</dd>
      {hint ? (
        <dd className="truncate text-xs text-muted-foreground">{hint}</dd>
      ) : null}
    </div>
  );
}
