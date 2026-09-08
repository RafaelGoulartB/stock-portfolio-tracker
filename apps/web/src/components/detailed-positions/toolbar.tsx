import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import {
  TableFilterChip,
  TableFilterTrigger,
  TableSearch,
  TableSegmentedOption,
  TableToolbar,
  TableToolbarEnd,
} from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CATEGORY_ALL, CATEGORY_NONE } from "@/lib/category-filter";
import { formatMonthLabel, type lastTwelveMonths } from "@/lib/months";
import { columnLabels, PRESETS, type PresetName } from "./columns";
import { COLUMN_IDS, type ColumnId } from "./types";

export type DetailedPositionsCategory = {
  id: string;
  name: string;
};

const detailedPositionsRemoveFilterMessage = msg({
  id: "detailedPositions.removeFilter",
  message: "Remove filter: {label}",
});

export function DetailedPositionsToolbar({
  search,
  onSearchChange,
  category,
  categoryFilterReady,
  categories,
  onCategoryChange,
  visibleColumns,
  onColumnsChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  categoryFilterReady: boolean;
  categories: readonly DetailedPositionsCategory[];
  onCategoryChange: (value: string) => void;
  visibleColumns: ReadonlySet<ColumnId>;
  onColumnsChange: (columns: Set<ColumnId>) => void;
}) {
  const { i18n } = useLingui();
  const categoryLabel =
    category === CATEGORY_NONE
      ? i18n._(t({ id: "allocation.categoryNone", message: "Uncategorized" }))
      : (categories.find((item) => item.id === category)?.name ?? category);

  return (
    <TableToolbar>
      <TableSearch
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        ariaLabel={i18n._(
          t({
            id: "detailedPositions.searchLabel",
            message: "Search detailed positions",
          }),
        )}
        placeholder={i18n._(
          t({
            id: "detailedPositions.search",
            message: "Search ticker or class…",
          }),
        )}
      />
      {categoryFilterReady ? (
        <>
          <DetailedPositionsCategoryFilter
            category={category}
            categories={categories}
            onCategoryChange={onCategoryChange}
          />
          {category !== CATEGORY_ALL ? (
            <TableFilterChip
              label={categoryLabel}
              removeLabel={i18n._(
                detailedPositionsRemoveFilterMessage.id ?? "",
                {
                  label: categoryLabel,
                },
              )}
              onRemove={() => onCategoryChange(CATEGORY_ALL)}
            />
          ) : null}
        </>
      ) : null}
      <TableToolbarEnd>
        <DetailedPositionsDisplayMenu
          visibleColumns={visibleColumns}
          onColumnsChange={onColumnsChange}
        />
      </TableToolbarEnd>
    </TableToolbar>
  );
}

function DetailedPositionsCategoryFilter({
  category,
  categories,
  onCategoryChange,
}: {
  category: string;
  categories: readonly DetailedPositionsCategory[];
  onCategoryChange: (value: string) => void;
}) {
  const { i18n } = useLingui();

  return (
    <Popover>
      <TableFilterTrigger activeCount={category === CATEGORY_ALL ? 0 : 1}>
        <Trans id="allocation.filters">Filters</Trans>
      </TableFilterTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] space-y-4"
      >
        <div className="space-y-2">
          <Label
            htmlFor="detailed-positions-filter-category"
            className="text-xs"
          >
            <Trans id="allocation.filterCategory">Category</Trans>
          </Label>
          <Select value={category} onValueChange={onCategoryChange}>
            <SelectTrigger
              id="detailed-positions-filter-category"
              size="sm"
              className="w-full"
              aria-label={i18n._(
                t({
                  id: "allocation.categoryFilter",
                  message: "Filter by category",
                }),
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CATEGORY_ALL}>
                <Trans id="allocation.categoryAll">All categories</Trans>
              </SelectItem>
              <SelectItem value={CATEGORY_NONE}>
                <Trans id="allocation.categoryNone">Uncategorized</Trans>
              </SelectItem>
              {categories.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DetailedPositionsDisplayMenu({
  visibleColumns,
  onColumnsChange,
}: {
  visibleColumns: ReadonlySet<ColumnId>;
  onColumnsChange: (columns: Set<ColumnId>) => void;
}) {
  const { i18n } = useLingui();
  const labels = columnLabels(i18n);
  const presets: { id: PresetName; label: string }[] = [
    {
      id: "compact",
      label: i18n._(t({ id: "detailedPositions.compact", message: "Compact" })),
    },
    {
      id: "standard",
      label: i18n._(
        t({ id: "detailedPositions.standard", message: "Standard" }),
      ),
    },
    {
      id: "all",
      label: i18n._(t({ id: "detailedPositions.all", message: "All data" })),
    },
  ];

  function applyPreset(preset: PresetName) {
    onColumnsChange(new Set(PRESETS[preset]));
  }

  function toggleColumn(id: ColumnId) {
    if (id === "ticker") {
      return;
    }

    const next = new Set(visibleColumns);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    onColumnsChange(next);
  }

  function matchesPreset(preset: PresetName) {
    const columns = PRESETS[preset];

    return (
      columns.length === visibleColumns.size &&
      columns.every((id) => visibleColumns.has(id))
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <SlidersHorizontal aria-hidden="true" />
          <Trans id="allocation.display">Display</Trans>
          <ChevronDown aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(26rem,calc(100vw-2rem))] space-y-4"
      >
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">
            <Trans id="allocation.presets">View presets</Trans>
          </legend>
          <div className="grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5">
            {presets.map((preset) => (
              <TableSegmentedOption
                key={preset.id}
                selected={matchesPreset(preset.id)}
                onSelect={() => applyPreset(preset.id)}
              >
                {preset.label}
              </TableSegmentedOption>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">
            <Trans id="detailedPositions.customize">Customize columns</Trans>
          </legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {COLUMN_IDS.map((id) => (
              <div key={id} className="flex items-center gap-2">
                <Checkbox
                  id={`detailed-positions-column-${id}`}
                  checked={visibleColumns.has(id)}
                  disabled={id === "ticker"}
                  onCheckedChange={() => toggleColumn(id)}
                />
                <Label
                  htmlFor={`detailed-positions-column-${id}`}
                  className="text-sm font-normal"
                >
                  {labels[id]}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full justify-start"
          onClick={() => applyPreset("standard")}
        >
          <RotateCcw aria-hidden="true" />
          <Trans id="detailedPositions.reset">Reset to standard</Trans>
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function MonthSelector({
  months,
  selectedKey,
  onSelect,
  locale,
}: {
  months: ReturnType<typeof lastTwelveMonths>;
  selectedKey: string;
  onSelect: (key: string) => void;
  locale: string;
}) {
  return (
    <>
      <Label htmlFor="detailed-positions-month" className="sr-only">
        <Trans id="positions.month">Snapshot month</Trans>
      </Label>
      <Select value={selectedKey} onValueChange={onSelect}>
        <SelectTrigger
          id="detailed-positions-month"
          size="sm"
          className="w-[168px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((month) => (
            <SelectItem key={month.key} value={month.key}>
              {month.current ? (
                <Trans id="positions.currentMonth">
                  {formatMonthLabel(month, locale)} · Live
                </Trans>
              ) : (
                formatMonthLabel(month, locale)
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

export function ErrorCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">
        {children}
      </CardContent>
    </Card>
  );
}

export function TableSkeleton() {
  const rows = ["one", "two", "three", "four", "five", "six", "seven"];
  return (
    <Card className="gap-3 p-5">
      <Skeleton className="h-8 w-full" />
      {rows.map((row) => (
        <Skeleton key={row} className="h-9 w-full" />
      ))}
    </Card>
  );
}
