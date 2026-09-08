import { Filter, Search, X } from "lucide-react";
import type { ChangeEventHandler, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/** Shared layout for search, filter and display controls above data tables. */
export function TableToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}

/** Right-aligned control group used by table toolbars. */
export function TableToolbarEnd({ children }: { children: ReactNode }) {
  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
  );
}

/** Shared trigger for filter popovers, including the active-filter count. */
export function TableFilterTrigger({
  activeCount,
  children,
}: {
  activeCount: number;
  children: ReactNode;
}) {
  return (
    <PopoverTrigger asChild>
      <Button
        type="button"
        size="sm"
        variant={activeCount > 0 ? "secondary" : "outline"}
      >
        <Filter aria-hidden="true" />
        {children}
        {activeCount > 0 ? (
          <Badge
            className="h-4 min-w-4 px-1 text-[0.625rem] tabular-nums"
            aria-hidden="true"
          >
            {activeCount}
          </Badge>
        ) : null}
      </Button>
    </PopoverTrigger>
  );
}

/** Standard compact search field used by data-table toolbars. */
export function TableSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <div className="relative min-w-48 flex-1 sm:max-w-xs">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={onChange}
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="h-8 pl-8"
      />
    </div>
  );
}

/** Applied-filter chip with one consistent removal affordance. */
export function TableFilterChip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <Badge asChild variant="secondary" className="gap-1 pr-1.5">
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        className="cursor-pointer hover:bg-secondary/70"
      >
        {label}
        <X aria-hidden="true" />
      </button>
    </Badge>
  );
}

/** Standard compact option used by table filter and display popovers. */
export function TableSegmentedOption({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "h-7 rounded-sm px-1 text-xs font-normal",
        selected && "bg-background font-medium shadow-xs",
      )}
    >
      {children}
    </Button>
  );
}
