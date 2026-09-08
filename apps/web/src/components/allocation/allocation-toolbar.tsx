import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  SlidersHorizontal,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  TableSearch,
  TableSegmentedOption,
  TableToolbar,
  TableToolbarEnd,
} from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  formatQuarterLabel,
  formatQuarterTitle,
  type Quarter,
  shiftQuarter,
} from "@/lib/quarters";
import {
  AllocationFilterChips,
  type AllocationFilterState,
  AllocationFiltersButton,
  type CategoryOption,
} from "./allocation-filters";
import {
  ALLOCATION_COLUMNS,
  type AllocationColumn,
  columnLabels,
} from "./allocation-table";

export const QUARTER_COUNTS = [3, 4, 5, 8] as const;
export const DEFAULT_QUARTER_COUNT = 4;

export const COLUMN_PRESETS: Record<
  "compact" | "standard" | "all",
  AllocationColumn[]
> = {
  compact: [
    "ticker",
    "targetWeight",
    "currentWeight",
    "gapWeight",
    "score",
    "marketValue",
  ],
  standard: [
    "ticker",
    "targetWeight",
    "currentWeight",
    "gapWeight",
    "discount",
    "score",
    "nextResult",
    "marketValue",
    "averageGrade",
  ],
  all: [...ALLOCATION_COLUMNS],
};

type ColumnPreset = keyof typeof COLUMN_PRESETS;

/** Sizing and holdings columns; the rest is research data. */
const SIZING_COLUMNS: AllocationColumn[] = [
  "ticker",
  "targetWeight",
  "currentWeight",
  "gapWeight",
  "marketValue",
  "quantity",
];
const RESEARCH_COLUMNS = ALLOCATION_COLUMNS.filter(
  (id) => !SIZING_COLUMNS.includes(id),
);

export type AllocationToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  filters: AllocationFilterState;
  onFiltersChange: (filters: AllocationFilterState) => void;
  categories: readonly CategoryOption[];
  /** Oldest visible quarter, used only for the window label. */
  quarterStart: Quarter;
  quarterEnd: Quarter;
  quarterCount: number;
  onQuarterEndChange: (quarter: Quarter) => void;
  /** Returns the window to the newest reviewed quarter. */
  onQuarterEndReset: () => void;
  onQuarterCountChange: (count: number) => void;
  visibleColumns: ReadonlySet<AllocationColumn>;
  onColumnsChange: (columns: Set<AllocationColumn>) => void;
  freeOrder: boolean;
  onFreeOrderChange: (value: boolean) => void;
};

/**
 * Allocation table controls, split by intent: search and filters decide which
 * rows appear, the quarter stepper navigates the review grid, and display
 * holds column and ordering preferences. New controls join one of the three
 * popovers instead of the persistent row, which stays four slots wide.
 */
export function AllocationToolbar({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
  categories,
  quarterStart,
  quarterEnd,
  quarterCount,
  onQuarterEndChange,
  onQuarterEndReset,
  onQuarterCountChange,
  visibleColumns,
  onColumnsChange,
  freeOrder,
  onFreeOrderChange,
}: AllocationToolbarProps) {
  const { i18n } = useLingui();

  return (
    <TableToolbar>
      <TableSearch
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        ariaLabel={i18n._(
          t({ id: "allocation.searchLabel", message: "Search assets" }),
        )}
        placeholder={i18n._(
          t({ id: "allocation.search", message: "Search ticker…" }),
        )}
      />

      <AllocationFiltersButton
        filters={filters}
        categories={categories}
        onChange={onFiltersChange}
      />
      <AllocationFilterChips
        filters={filters}
        categories={categories}
        onChange={onFiltersChange}
        freeOrder={freeOrder}
        onFreeOrderChange={onFreeOrderChange}
      />

      <TableToolbarEnd>
        <QuarterWindow
          quarterStart={quarterStart}
          quarterEnd={quarterEnd}
          quarterCount={quarterCount}
          onQuarterEndChange={onQuarterEndChange}
          onQuarterEndReset={onQuarterEndReset}
          onQuarterCountChange={onQuarterCountChange}
        />
        <DisplayMenu
          visibleColumns={visibleColumns}
          onColumnsChange={onColumnsChange}
          freeOrder={freeOrder}
          onFreeOrderChange={onFreeOrderChange}
        />
      </TableToolbarEnd>
    </TableToolbar>
  );
}

/**
 * One control for the review window: the arrows move it and the label opens
 * its length, so the two settings that describe the same range stay together.
 */
function QuarterWindow({
  quarterStart,
  quarterEnd,
  quarterCount,
  onQuarterEndChange,
  onQuarterEndReset,
  onQuarterCountChange,
}: {
  quarterStart: Quarter;
  quarterEnd: Quarter;
  quarterCount: number;
  onQuarterEndChange: (quarter: Quarter) => void;
  onQuarterEndReset: () => void;
  onQuarterCountChange: (count: number) => void;
}) {
  const { i18n } = useLingui();
  const range = `${formatQuarterTitle(quarterStart)} — ${formatQuarterTitle(
    quarterEnd,
  )}`;

  return (
    <div className="flex items-center gap-0.5 rounded-md border px-0.5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={i18n._(
          t({
            id: "allocation.quartersBack",
            message: "Show earlier quarters",
          }),
        )}
        onClick={() => onQuarterEndChange(shiftQuarter(quarterEnd, -1))}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 min-w-28 px-1 text-xs font-normal text-muted-foreground tabular-nums"
            aria-label={i18n._(
              t({
                id: "allocation.quarterWindowAria",
                message: `Quarter window: ${range}`,
              }),
            )}
          >
            {formatQuarterLabel(quarterStart)} —{" "}
            {formatQuarterLabel(quarterEnd)}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          className="w-[min(18rem,calc(100vw-2rem))] space-y-3"
        >
          <div className="space-y-1">
            <p className="text-sm font-medium">
              <Trans id="allocation.quarterWindow">Quarter window</Trans>
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans id="allocation.quarterWindowHelp">
                How many quarters the review grid shows, ending at{" "}
                {formatQuarterTitle(quarterEnd)}.
              </Trans>
            </p>
          </div>
          <fieldset>
            <legend className="sr-only">
              <Trans id="allocation.quarterCount">Quarters shown</Trans>
            </legend>
            <div className="grid grid-cols-4 gap-0.5 rounded-md bg-muted p-0.5">
              {QUARTER_COUNTS.map((count) => (
                <TableSegmentedOption
                  key={count}
                  selected={count === quarterCount}
                  onSelect={() => onQuarterCountChange(count)}
                >
                  {count}
                </TableSegmentedOption>
              ))}
            </div>
          </fieldset>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={onQuarterEndReset}
          >
            <RotateCcw aria-hidden="true" />
            <Trans id="allocation.quarterWindowLatest">
              Back to latest reviewed
            </Trans>
          </Button>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={i18n._(
          t({
            id: "allocation.quartersForward",
            message: "Show later quarters",
          }),
        )}
        onClick={() => onQuarterEndChange(shiftQuarter(quarterEnd, 1))}
      >
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Column visibility and row ordering: what the table shows, not which rows. */
function DisplayMenu({
  visibleColumns,
  onColumnsChange,
  freeOrder,
  onFreeOrderChange,
}: {
  visibleColumns: ReadonlySet<AllocationColumn>;
  onColumnsChange: (columns: Set<AllocationColumn>) => void;
  freeOrder: boolean;
  onFreeOrderChange: (value: boolean) => void;
}) {
  const { i18n } = useLingui();
  const labels = columnLabels(i18n);

  function toggleColumn(id: AllocationColumn) {
    // The ticker column identifies the row and always stays visible.
    if (id === "ticker") return;

    const next = new Set(visibleColumns);

    if (next.has(id)) next.delete(id);
    else next.add(id);

    onColumnsChange(next);
  }

  function matchesPreset(preset: ColumnPreset): boolean {
    const columns = COLUMN_PRESETS[preset];

    return (
      columns.length === visibleColumns.size &&
      columns.every((id) => visibleColumns.has(id))
    );
  }

  const presets: { id: ColumnPreset; label: string }[] = [
    {
      id: "compact",
      label: i18n._(t({ id: "allocation.compact", message: "Compact" })),
    },
    {
      id: "standard",
      label: i18n._(t({ id: "allocation.standard", message: "Standard" })),
    },
    {
      id: "all",
      label: i18n._(t({ id: "allocation.all", message: "All data" })),
    },
  ];

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
                onSelect={() =>
                  onColumnsChange(new Set(COLUMN_PRESETS[preset.id]))
                }
              >
                {preset.label}
              </TableSegmentedOption>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <ColumnGroup
            title={
              <Trans id="allocation.columnsSizing">Sizing and holdings</Trans>
            }
            columns={SIZING_COLUMNS}
            labels={labels}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
          />
          <ColumnGroup
            title={<Trans id="allocation.columnsResearch">Research</Trans>}
            columns={RESEARCH_COLUMNS}
            labels={labels}
            visibleColumns={visibleColumns}
            onToggle={toggleColumn}
          />
        </div>

        <Separator />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="allocation-free-order" className="text-sm">
              <Trans id="allocation.freeOrder">Free order</Trans>
            </Label>
            <Switch
              id="allocation-free-order"
              checked={freeOrder}
              onCheckedChange={onFreeOrderChange}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            <Trans id="allocation.freeOrderHelp">
              Drag rows into your own order. Column sorting is paused while it
              is on.
            </Trans>
          </p>
        </div>

        <Separator />

        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="w-full justify-start"
          onClick={() => onColumnsChange(new Set(COLUMN_PRESETS.standard))}
        >
          <RotateCcw aria-hidden="true" />
          <Trans id="allocation.reset">Reset to standard</Trans>
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ColumnGroup({
  title,
  columns,
  labels,
  visibleColumns,
  onToggle,
}: {
  title: ReactNode;
  columns: readonly AllocationColumn[];
  labels: Record<AllocationColumn, string>;
  visibleColumns: ReadonlySet<AllocationColumn>;
  onToggle: (id: AllocationColumn) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-xs font-medium text-muted-foreground">
        {title}
      </legend>
      <div className="space-y-1.5">
        {columns.map((id) => (
          <div key={id} className="flex items-center gap-2">
            <Checkbox
              id={`allocation-column-${id}`}
              checked={visibleColumns.has(id)}
              disabled={id === "ticker"}
              onCheckedChange={() => onToggle(id)}
            />
            <Label
              htmlFor={`allocation-column-${id}`}
              className="text-sm font-normal"
            >
              {labels[id]}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
