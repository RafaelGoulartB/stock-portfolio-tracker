import { msg, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  CATEGORY_COLORS,
  type CategoryColor,
  createCategoryInput,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";
import { AssetClassLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { AssetLogo } from "@/components/asset-logo";
import { sumDecimalStrings } from "@/components/detailed-positions/decimal-sum";
import { ShareBar } from "@/components/positions/shared";
import {
  TableFilterChip,
  TableFilterTrigger,
  TableSearch,
  TableToolbar,
} from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTitleIcon,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolioQueryInput } from "@/lib/allocation-query";
import { type RouterOutputs, trpc } from "@/lib/api";
import {
  CATEGORY_ALL as ALL,
  CATEGORY_NONE as NONE,
} from "@/lib/category-filter";
import { formatMoney, formatWeight } from "@/lib/format";
import { prefetchPortfolio, trpcQueryUtils } from "@/lib/route-prefetch";
import { categoryErrorMessage, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/categories")({
  // The live holdings are the Positions query, so a visit from there
  // reuses its cache for the values and shares below.
  loader: ({ preload }) =>
    prefetchPortfolio(preload, (input) => [
      trpcQueryUtils.categories.list.prefetch(),
      trpcQueryUtils.positions.list.prefetch({ ...input, asOf: undefined }),
    ]),
  component: CategoriesPage,
});

/** An open position; fixed income and unquoted ones carry no value. */
type Holding = { value: string | null; weight: string | null };
type BucketStats = { value: string; weight: string; held: number };

type CategoryList = RouterOutputs["categories"]["list"];
type CategoryRow = CategoryList["categories"][number];
type AssetRow = CategoryList["assets"][number];

function swatchStyle(color: CategoryColor): { backgroundColor: string } {
  return { backgroundColor: `var(--${color})` };
}

function CategoriesPage() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();
  const list = trpc.categories.list.useQuery();
  const portfolioInput = usePortfolioQueryInput();
  const positions = trpc.positions.list.useQuery({
    ...portfolioInput,
    asOf: undefined,
  });

  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(ALL);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState(NONE);
  const [rename, setRename] = useState<CategoryRow | null>(null);
  const [renameName, setRenameName] = useState("");
  const [remove, setRemove] = useState<CategoryRow | null>(null);

  function sync(data: CategoryList) {
    utils.categories.list.setData(undefined, data);
    // The allocation watchlist finder filters by category on the server.
    void utils.allocation.finder.invalidate();
  }

  const create = trpc.categories.create.useMutation({
    onSuccess: (data) => {
      toast.success(
        i18n._(msg({ id: "categories.created", message: "Category created" })),
      );
      setName("");
      sync(data);
    },
    onError: (error) => toast.error(categoryErrorMessage(error)),
  });

  const update = trpc.categories.update.useMutation({
    onSuccess: (data) => {
      toast.success(
        i18n._(msg({ id: "categories.updated", message: "Category updated" })),
      );
      setRename(null);
      sync(data);
    },
    onError: (error) => toast.error(categoryErrorMessage(error)),
  });

  const destroy = trpc.categories.remove.useMutation({
    onSuccess: (data, input) => {
      toast.success(
        i18n._(msg({ id: "categories.removed", message: "Category removed" })),
      );
      setRemove(null);
      setFilter((current) => (current === input.id ? ALL : current));
      sync(data);
    },
    onError: (error) => toast.error(categoryErrorMessage(error)),
  });

  const assign = trpc.categories.assign.useMutation({
    onSuccess: sync,
    onError: (error) => toast.error(categoryErrorMessage(error)),
  });

  const assignMany = trpc.categories.assignMany.useMutation({
    onSuccess: (data, input) => {
      toast.success(
        t({
          id: "categories.moved",
          message: plural(
            { count: input.tickers.length },
            {
              one: "# ticker moved",
              other: "# tickers moved",
            },
          ),
        }),
      );
      setSelected(new Set());
      sync(data);
    },
    onError: (error) => toast.error(categoryErrorMessage(error)),
  });

  const categories = list.data?.categories ?? [];
  const assets = list.data?.assets ?? [];

  /** Live value and share of every open holding, by ticker. */
  const holdings = useMemo(() => {
    const map = new Map<string, Holding>();

    for (const position of positions.data?.positions ?? []) {
      if (position.assetClass !== "cash" && Number(position.quantity) > 0) {
        map.set(position.ticker, {
          value: position.convertedMarketValue,
          weight: position.weight,
        });
      }
    }

    return map;
  }, [positions.data]);
  const displayCurrency = positions.data?.summary.displayCurrency;

  /** Display-only totals per bucket; `NONE` collects the uncategorized. */
  const bucketStats = useMemo(() => {
    const members = new Map<string, Holding[]>();

    for (const asset of assets) {
      const key = asset.categoryId ?? NONE;
      const holding = holdings.get(asset.ticker);
      const list = members.get(key) ?? [];

      if (holding?.value != null) {
        list.push(holding);
      }

      members.set(key, list);
    }

    return new Map<string, BucketStats>(
      [...members].map(([key, list]) => [
        key,
        {
          value: sumDecimalStrings(list.map((entry) => entry.value)),
          weight: sumDecimalStrings(
            list.map((entry) => entry.weight),
            8,
          ),
          held: list.length,
        },
      ]),
    );
  }, [assets, holdings]);
  const categorizedCount = assets.filter(
    (asset) => asset.categoryId !== null,
  ).length;
  const uncategorizedCount = assets.length - categorizedCount;

  const filtered = useMemo(() => {
    const needle = query.trim().toUpperCase();

    return assets
      .filter((asset) => {
        if (needle && !asset.ticker.includes(needle)) {
          return false;
        }

        if (filter === ALL) {
          return true;
        }

        if (filter === NONE) {
          return asset.categoryId === null;
        }

        return asset.categoryId === filter;
      })
      .sort((a, b) => {
        // Held tickers first, largest first; watch-only ones alphabetically.
        const left = Number(holdings.get(a.ticker)?.value ?? -1);
        const right = Number(holdings.get(b.ticker)?.value ?? -1);

        return left === right
          ? a.ticker.localeCompare(b.ticker, i18n.locale)
          : right - left;
      });
  }, [assets, filter, query, holdings, i18n.locale]);

  const visibleTickers = filtered.map((asset) => asset.ticker);
  const selectedVisibleCount = visibleTickers.filter((ticker) =>
    selected.has(ticker),
  ).length;
  let headerState: boolean | "indeterminate" = false;

  if (filtered.length > 0 && selectedVisibleCount === filtered.length) {
    headerState = true;
  } else if (selectedVisibleCount > 0) {
    headerState = "indeterminate";
  }

  function toggleAll(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);

      for (const ticker of visibleTickers) {
        if (checked) {
          next.add(ticker);
        } else {
          next.delete(ticker);
        }
      }

      return next;
    });
  }

  function toggleOne(ticker: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(ticker);
      } else {
        next.delete(ticker);
      }

      return next;
    });
  }

  function submitNew(event: FormEvent) {
    const parsed = createCategoryInput.safeParse({ name });

    event.preventDefault();

    if (!parsed.success) {
      toast.error(
        i18n._(
          msg({
            id: "categories.nameRequired",
            message: "Give the category a name.",
          }),
        ),
      );
      return;
    }

    create.mutate(parsed.data);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Trans id="categories.title">My categories</Trans>
        </h1>
        <p className="text-sm text-muted-foreground">
          <Trans id="categories.subtitle">
            Create your own labels and assign them to tickers, one by one or in
            bulk.
          </Trans>
        </p>
      </header>

      {list.isError ? (
        <p className="text-sm text-destructive">
          {queryErrorMessage(list.error)}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans id="categories.listTitle">Categories</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="categories.listHint">
              Names are yours. Deleting a category leaves its tickers
              uncategorized.
            </Trans>
          </CardDescription>
          {assets.length > 0 && categories.length > 0 ? (
            <div className="space-y-1.5 pt-1">
              <p className="text-xs text-muted-foreground tabular-nums">
                <Trans id="categories.coverage">
                  {categorizedCount} of {assets.length} tickers categorized
                </Trans>
              </p>
              <ShareBar
                className="h-1.5 max-w-sm"
                fraction={categorizedCount / assets.length}
              />
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={submitNew}
          >
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={40}
              placeholder={i18n._(
                msg({
                  id: "categories.namePlaceholder",
                  message: "e.g. Growth, Income, Satellite",
                }),
              )}
              aria-label={i18n._(
                msg({ id: "categories.name", message: "Category name" }),
              )}
            />
            <Button type="submit" disabled={create.isPending}>
              <Plus className="size-4" aria-hidden="true" />
              <Trans id="categories.add">Add category</Trans>
            </Button>
          </form>

          {list.isLoading ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans id="categories.empty">
                No categories yet. Add one to start grouping tickers.
              </Trans>
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {categories.map((category) => {
                const stats = bucketStats.get(category.id);

                return (
                  <li
                    key={category.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border bg-background px-3 py-2.5 transition-colors",
                      filter === category.id && "border-primary/60 bg-muted/40",
                    )}
                  >
                    <ColorSwatch
                      color={category.color}
                      label={i18n._(
                        msg({
                          id: "categories.changeColor",
                          message: "Change color",
                        }),
                      )}
                      disabled={update.isPending}
                      onPick={(color) =>
                        update.mutate({ id: category.id, color })
                      }
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-pressed={filter === category.id}
                      title={i18n._(
                        msg({
                          id: "categories.showOnly",
                          message: "Show only these tickers",
                        }),
                      )}
                      onClick={() =>
                        setFilter((current) =>
                          current === category.id ? ALL : category.id,
                        )
                      }
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">
                          {category.name}
                        </span>
                        {stats && stats.held > 0 ? (
                          <span className="shrink-0 text-sm font-medium tabular-nums">
                            {formatWeight(stats.weight)}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          {t({
                            id: "categories.assetCount",
                            message: plural(
                              { count: category.assetCount },
                              { one: "# ticker", other: "# tickers" },
                            ),
                          })}
                        </span>
                        {stats && stats.held > 0 && displayCurrency ? (
                          <span className="tabular-nums">
                            {formatMoney(stats.value, displayCurrency)}
                          </span>
                        ) : null}
                      </span>
                      <ShareBar
                        className="mt-2 h-1.5"
                        color={`var(--${category.color})`}
                        fraction={Number(stats?.weight ?? 0)}
                      />
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={i18n._(
                        msg({ id: "categories.rename", message: "Rename" }),
                      )}
                      onClick={() => {
                        setRename(category);
                        setRenameName(category.name);
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={i18n._(
                        msg({ id: "categories.delete", message: "Delete" }),
                      )}
                      onClick={() => setRemove(category)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
              {uncategorizedCount > 0 ? (
                <li>
                  <button
                    type="button"
                    className={cn(
                      "h-full w-full cursor-pointer rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      filter === NONE && "border-primary/60 bg-muted/40",
                    )}
                    aria-pressed={filter === NONE}
                    onClick={() =>
                      setFilter((current) => (current === NONE ? ALL : NONE))
                    }
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-muted-foreground">
                        <Trans id="categories.uncategorized">
                          Uncategorized
                        </Trans>
                      </span>
                      {(bucketStats.get(NONE)?.held ?? 0) > 0 ? (
                        <span className="text-sm font-medium text-muted-foreground tabular-nums">
                          {formatWeight(bucketStats.get(NONE)?.weight ?? "0")}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {t({
                        id: "categories.assetCount",
                        message: plural(
                          { count: uncategorizedCount },
                          { one: "# ticker", other: "# tickers" },
                        ),
                      })}
                    </span>
                  </button>
                </li>
              ) : null}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans id="categories.assetsTitle">Assets</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="categories.assetsHint">
              Select several tickers and move them together when the list is
              long.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TableToolbar>
            <TableSearch
              value={query}
              onValueChange={setQuery}
              placeholder={i18n._(
                msg({
                  id: "categories.searchPlaceholder",
                  message: "Search ticker",
                }),
              )}
              ariaLabel={i18n._(
                msg({
                  id: "categories.search",
                  message: "Search ticker",
                }),
              )}
            />
            <CategoryFilterMenu
              value={filter}
              categories={categories}
              onChange={setFilter}
            />
            {filter !== ALL ? (
              <TableFilterChip
                label={
                  filter === NONE
                    ? i18n._(
                        msg({
                          id: "categories.uncategorized",
                          message: "Uncategorized",
                        }),
                      )
                    : (categories.find((category) => category.id === filter)
                        ?.name ?? filter)
                }
                removeLabel={i18n._(
                  msg({
                    id: "categories.removeFilter",
                    message: "Remove category filter",
                  }),
                )}
                onRemove={() => setFilter(ALL)}
              />
            ) : null}
          </TableToolbar>

          {selected.size > 0 ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center">
              <p className="text-sm font-medium">
                {t({
                  id: "categories.selectedCount",
                  message: plural(
                    { count: selected.size },
                    { one: "# selected", other: "# selected" },
                  ),
                })}
              </p>
              <Select value={bulkCategory} onValueChange={setBulkCategory}>
                <SelectTrigger
                  className="w-full sm:ml-auto sm:w-56"
                  aria-label={i18n._(
                    msg({
                      id: "categories.moveTo",
                      message: "Move to…",
                    }),
                  )}
                >
                  <SelectValue
                    placeholder={i18n._(
                      msg({
                        id: "categories.moveTo",
                        message: "Move to…",
                      }),
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>
                    <Trans id="categories.uncategorized">Uncategorized</Trans>
                  </SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                disabled={assignMany.isPending}
                onClick={() =>
                  assignMany.mutate({
                    tickers: [...selected],
                    categoryId: bulkCategory === NONE ? null : bulkCategory,
                  })
                }
              >
                <Trans id="categories.move">Move</Trans>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelected(new Set())}
              >
                <Trans id="categories.clearSelection">Clear</Trans>
              </Button>
            </div>
          ) : null}

          {list.isLoading ? (
            <Skeleton className="h-40" />
          ) : assets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <Tags className="size-8" aria-hidden="true" />
              <Trans id="categories.noAssets">
                No tickers yet. Register a trade or add a watch-only asset on
                Allocation.
              </Trans>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Trans id="categories.noMatches">
                No tickers match this filter.
              </Trans>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={headerState}
                      onCheckedChange={(value) => toggleAll(value === true)}
                      aria-label={i18n._(
                        msg({
                          id: "categories.selectAll",
                          message: "Select all visible tickers",
                        }),
                      )}
                    />
                  </TableHead>
                  <TableHead>
                    <Trans id="categories.colTicker">Ticker</Trans>
                  </TableHead>
                  <TableHead className="hidden text-right md:table-cell">
                    <Trans id="categories.colValue">Value</Trans>
                  </TableHead>
                  <TableHead className="hidden text-right sm:table-cell">
                    <Trans id="categories.colShare">Share</Trans>
                  </TableHead>
                  <TableHead>
                    <Trans id="categories.colCategory">Category</Trans>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((asset) => (
                  <AssetTableRow
                    key={asset.ticker}
                    asset={asset}
                    categories={categories}
                    selected={selected.has(asset.ticker)}
                    holding={holdings.get(asset.ticker)}
                    currency={displayCurrency}
                    assigning={assign.isPending}
                    onToggle={(checked) => toggleOne(asset.ticker, checked)}
                    onAssign={(categoryId) =>
                      assign.mutate({ ticker: asset.ticker, categoryId })
                    }
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={rename !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRename(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <DialogTitleIcon>
                <Pencil aria-hidden="true" />
              </DialogTitleIcon>
              <Trans id="categories.renameTitle">Rename category</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans id="categories.renameHint">
                Tickers already in this category keep the assignment.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!rename) {
                return;
              }

              const parsed = createCategoryInput.safeParse({
                name: renameName,
              });

              if (!parsed.success) {
                toast.error(
                  i18n._(
                    msg({
                      id: "categories.nameRequired",
                      message: "Give the category a name.",
                    }),
                  ),
                );
                return;
              }

              update.mutate({ id: rename.id, name: parsed.data.name });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="rename-category">
                <Trans id="categories.name">Category name</Trans>
              </Label>
              <Input
                id="rename-category"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                maxLength={40}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRename(null)}
              >
                <Trans id="categories.cancel">Cancel</Trans>
              </Button>
              <Button type="submit" disabled={update.isPending}>
                <Trans id="categories.save">Save</Trans>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemove(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <DialogTitleIcon>
                <Trash2 aria-hidden="true" />
              </DialogTitleIcon>
              <Trans id="categories.deleteTitle">Delete category?</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans id="categories.deleteHint">
                Tickers in this category become uncategorized. The category
                itself is removed.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRemove(null)}
            >
              <Trans id="categories.cancel">Cancel</Trans>
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={destroy.isPending || !remove}
              onClick={() => {
                if (remove) {
                  destroy.mutate({ id: remove.id });
                }
              }}
            >
              <Trans id="categories.delete">Delete</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CategoryFilterMenu({
  value,
  categories,
  onChange,
}: {
  value: string;
  categories: readonly CategoryRow[];
  onChange: (value: string) => void;
}) {
  const { i18n } = useLingui();
  const active = value !== ALL;

  return (
    <Popover>
      <TableFilterTrigger activeCount={active ? 1 : 0}>
        <Trans id="allocation.filters">Filters</Trans>
      </TableFilterTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="categories-filter-category" className="text-xs">
            <Trans id="categories.filterCategory">Category</Trans>
          </Label>
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger
              id="categories-filter-category"
              size="sm"
              className="w-full"
              aria-label={i18n._(
                msg({
                  id: "categories.filter",
                  message: "Filter by category",
                }),
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>
                <Trans id="categories.filterAll">All tickers</Trans>
              </SelectItem>
              <SelectItem value={NONE}>
                <Trans id="categories.uncategorized">Uncategorized</Trans>
              </SelectItem>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AssetTableRow({
  asset,
  categories,
  selected,
  holding,
  currency,
  assigning,
  onToggle,
  onAssign,
}: {
  asset: AssetRow;
  categories: CategoryRow[];
  selected: boolean;
  /** Live value of the held position; absent for watch-only tickers. */
  holding: Holding | undefined;
  currency: "BRL" | "USD" | undefined;
  assigning: boolean;
  onToggle: (checked: boolean) => void;
  onAssign: (categoryId: string | null) => void;
}) {
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onToggle(value === true)}
          aria-label={t({
            id: "categories.selectTicker",
            message: `Select ${asset.ticker}`,
          })}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <AssetLogo
            ticker={asset.ticker}
            assetClass={asset.assetClass}
            currency={asset.currency}
          />
          <div className="min-w-0 leading-tight">
            <AssetLink ticker={asset.ticker} className="font-medium">
              {asset.ticker}
            </AssetLink>
            <p className="text-xs text-muted-foreground">
              <AssetClassLabel assetClass={asset.assetClass} /> ·{" "}
              {asset.currency}
              {holding ? null : (
                <>
                  {" · "}
                  <Trans id="categories.watchOnly">watch-only</Trans>
                </>
              )}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">
        {holding?.value != null && currency ? (
          formatMoney(holding.value, currency)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">
        {holding?.weight ? formatWeight(holding.weight) : "—"}
      </TableCell>
      <TableCell>
        <Select
          value={asset.categoryId ?? NONE}
          disabled={assigning}
          onValueChange={(value) => onAssign(value === NONE ? null : value)}
        >
          <SelectTrigger
            size="sm"
            className="w-full min-w-32 sm:min-w-40"
            aria-label={t({
              id: "categories.assignTicker",
              message: `Category for ${asset.ticker}`,
            })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>
              <Trans id="categories.uncategorized">Uncategorized</Trans>
            </SelectItem>
            {categories.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}

function ColorSwatch({
  color,
  label,
  disabled,
  onPick,
}: {
  color: CategoryColor;
  label: string;
  disabled: boolean;
  onPick: (color: CategoryColor) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          className="size-6 shrink-0 rounded-full border shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          style={swatchStyle(color)}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-5 gap-1.5">
          {CATEGORY_COLORS.map((token) => (
            <button
              key={token}
              type="button"
              aria-label={token}
              className={cn(
                "size-6 rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                token === color && "ring-2 ring-ring ring-offset-2",
              )}
              style={swatchStyle(token)}
              onClick={() => onPick(token)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
