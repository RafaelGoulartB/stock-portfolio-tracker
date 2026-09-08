import type { I18n } from "@lingui/core";
import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { X } from "lucide-react";
import {
  TableFilterChip,
  TableFilterTrigger,
  TableSegmentedOption,
} from "@/components/table-toolbar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { CATEGORY_ALL, CATEGORY_NONE } from "@/lib/category-filter";

const allocationRemoveFilterMessage = msg({
  id: "allocation.removeFilter",
  message: "Remove filter: {label}",
});

export const STATUS_FILTERS = ["any", "invested", "radar"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type AllocationFilterState = {
  /** A category id, `all`, or `none` for uncategorized assets. */
  category: string;
  status: StatusFilter;
};

export const DEFAULT_ALLOCATION_FILTERS: AllocationFilterState = {
  category: CATEGORY_ALL,
  status: "any",
};

export type CategoryOption = { id: string; name: string };

const FILTER_STORAGE_KEY = "portfolio.allocation.filters.v1";

/**
 * Filters are persisted because the toolbar always renders a chip for every
 * active one: a restored filter stays visible instead of silently hiding rows.
 */
export function readStoredFilters(): AllocationFilterState {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(FILTER_STORAGE_KEY) ?? "null",
    );

    if (parsed === null || typeof parsed !== "object") {
      return DEFAULT_ALLOCATION_FILTERS;
    }

    const { category, status } = parsed as Partial<AllocationFilterState>;

    return {
      category: typeof category === "string" ? category : CATEGORY_ALL,
      status: STATUS_FILTERS.includes(status as StatusFilter)
        ? (status as StatusFilter)
        : "any",
    };
  } catch {
    return DEFAULT_ALLOCATION_FILTERS;
  }
}

export function storeFilters(filters: AllocationFilterState): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Storage is a convenience; the choice still applies to this session.
  }
}

export function activeFilterCount(filters: AllocationFilterState): number {
  return (
    (filters.category === CATEGORY_ALL ? 0 : 1) +
    (filters.status === "any" ? 0 : 1)
  );
}

/** Whether a row's category passes `filters`. */
export function matchesStatus(
  filters: AllocationFilterState,
  hasPosition: boolean,
): boolean {
  if (filters.status === "invested") {
    return hasPosition;
  }

  if (filters.status === "radar") {
    return !hasPosition;
  }

  return true;
}

function statusLabels(i18n: I18n) {
  return {
    any: i18n._(t({ id: "allocation.statusAny", message: "Any" })),
    invested: i18n._(t({ id: "allocation.statusInvested", message: "Held" })),
    radar: i18n._(t({ id: "allocation.statusRadar", message: "On radar" })),
  } satisfies Record<StatusFilter, string>;
}

export function AllocationFiltersButton({
  filters,
  categories,
  onChange,
}: {
  filters: AllocationFilterState;
  categories: readonly CategoryOption[];
  onChange: (filters: AllocationFilterState) => void;
}) {
  const { i18n } = useLingui();
  const count = activeFilterCount(filters);
  const labels = statusLabels(i18n);

  return (
    <Popover>
      <TableFilterTrigger activeCount={count}>
        <Trans id="allocation.filters">Filters</Trans>
      </TableFilterTrigger>
      <PopoverContent
        align="start"
        className="w-[min(20rem,calc(100vw-2rem))] space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="allocation-filter-category" className="text-xs">
            <Trans id="allocation.filterCategory">Category</Trans>
          </Label>
          <Select
            value={filters.category}
            onValueChange={(category) => onChange({ ...filters, category })}
          >
            <SelectTrigger
              id="allocation-filter-category"
              size="sm"
              className="w-full"
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
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium">
            <Trans id="allocation.filterStatus">Position</Trans>
          </legend>
          <div className="grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5">
            {STATUS_FILTERS.map((status) => (
              <TableSegmentedOption
                key={status}
                selected={filters.status === status}
                onSelect={() => onChange({ ...filters, status })}
              >
                {labels[status]}
              </TableSegmentedOption>
            ))}
          </div>
        </fieldset>

        {count > 0 ? (
          <>
            <Separator />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => onChange(DEFAULT_ALLOCATION_FILTERS)}
            >
              <X aria-hidden="true" />
              <Trans id="allocation.clearFilters">Clear filters</Trans>
            </Button>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One chip per active filter, so an applied filter is never invisible. Chips
 * are the only affordance the toolbar spends space on when nothing is set.
 */
export function AllocationFilterChips({
  filters,
  categories,
  onChange,
  freeOrder,
  onFreeOrderChange,
}: {
  filters: AllocationFilterState;
  categories: readonly CategoryOption[];
  onChange: (filters: AllocationFilterState) => void;
  freeOrder: boolean;
  onFreeOrderChange: (value: boolean) => void;
}) {
  const { i18n } = useLingui();
  const labels = statusLabels(i18n);
  const categoryLabel =
    filters.category === CATEGORY_NONE
      ? i18n._(t({ id: "allocation.categoryNone", message: "Uncategorized" }))
      : categories.find((category) => category.id === filters.category)?.name;

  return (
    <>
      {filters.category !== CATEGORY_ALL && categoryLabel ? (
        <TableFilterChip
          label={categoryLabel}
          removeLabel={i18n._(allocationRemoveFilterMessage.id ?? "", {
            label: categoryLabel,
          })}
          onRemove={() => onChange({ ...filters, category: CATEGORY_ALL })}
        />
      ) : null}
      {filters.status !== "any" ? (
        <TableFilterChip
          label={labels[filters.status]}
          removeLabel={i18n._(allocationRemoveFilterMessage.id ?? "", {
            label: labels[filters.status],
          })}
          onRemove={() => onChange({ ...filters, status: "any" })}
        />
      ) : null}
      {freeOrder ? (
        <TableFilterChip
          label={i18n._(
            t({ id: "allocation.freeOrder", message: "Free order" }),
          )}
          onRemove={() => onFreeOrderChange(false)}
          removeLabel={i18n._(
            t({
              id: "allocation.freeOrderDisable",
              message: "Turn off free order",
            }),
          )}
        />
      ) : null}
    </>
  );
}
