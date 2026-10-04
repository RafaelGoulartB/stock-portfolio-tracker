import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { TableHead } from "@/components/ui/table";
import { formatPercentAxis } from "@/lib/format";
import { heatTint } from "@/lib/heat";
import { cn } from "@/lib/utils";

/**
 * Row of headline numbers. Cells sit on a 1px grid gap so the dividers stay
 * correct however many columns the viewport fits.
 */
export function StatStrip({
  children,
  footer,
  className,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className={cn("grid gap-px bg-border", className)}>{children}</div>
      {footer ? (
        <div className="border-t bg-muted/30 px-5 py-2.5 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}

export function Stat({
  label,
  value,
  valueClassName,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  valueClassName?: string;
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 bg-card px-5 py-4", className)}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-xl font-semibold tracking-tight",
          valueClassName,
        )}
      >
        {value}
      </p>
      {hint ? (
        <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          {hint}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Rising / falling / flat counts as one proportional bar with a legend. */
export function BreadthBar({
  advancing,
  declining,
  unchanged,
}: {
  advancing: number;
  declining: number;
  unchanged: number;
}) {
  const { i18n } = useLingui();
  const total = advancing + declining + unchanged;

  if (total === 0) {
    return null;
  }

  const segments = [
    { key: "up", count: advancing, color: "var(--gain)" },
    { key: "flat", count: unchanged, color: "var(--muted-foreground)" },
    { key: "down", count: declining, color: "var(--loss)" },
  ].filter((segment) => segment.count > 0);

  return (
    <div className="mt-2.5 space-y-1.5">
      <div
        role="img"
        aria-label={i18n._(
          t({
            id: "analysis.breadthLabel",
            message: `${advancing} rising, ${declining} falling, ${unchanged} flat`,
          }),
        )}
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
      >
        {segments.map((segment) => (
          <span
            key={segment.key}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${(segment.count / total) * 100}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
      </div>
      <p className="flex gap-3 text-xs text-muted-foreground tabular-nums">
        <span className="inline-flex items-center gap-1">
          <ArrowUp className="size-3 text-gain" aria-hidden="true" />
          <Trans id="analysis.rising">{advancing} rising</Trans>
        </span>
        <span className="inline-flex items-center gap-1">
          <ArrowDown className="size-3 text-loss" aria-hidden="true" />
          <Trans id="analysis.falling">{declining} falling</Trans>
        </span>
        {unchanged > 0 ? (
          <span>
            <Trans id="analysis.flat">{unchanged} flat</Trans>
          </span>
        ) : null}
      </p>
    </div>
  );
}

/**
 * Inline bar centered on zero: gains grow right, losses grow left. The
 * number always sits next to it, so the bar is decorative for assistive
 * technology.
 */
export function DivergingBar({
  value,
  max,
  className,
}: {
  value: number | null;
  max: number;
  className?: string;
}) {
  const share =
    value == null || max <= 0 ? 0 : Math.min(Math.abs(value) / max, 1);

  return (
    <span
      aria-hidden="true"
      className={cn("relative block h-2 w-full min-w-12", className)}
    >
      <span className="absolute inset-y-[-2px] left-1/2 w-px bg-border" />
      {share > 0 && value != null ? (
        <span
          className={cn(
            "absolute inset-y-0 rounded-[2px]",
            value > 0 ? "left-1/2 ml-px bg-gain" : "right-1/2 mr-px bg-loss",
          )}
          style={{ width: `calc(${share * 50}% - 1px)` }}
        />
      ) : null}
    </span>
  );
}

/** Scale key for a diverging heat: `-cap … 0 … +cap`. */
export function HeatLegend({ cap }: { cap: number }) {
  const steps = [-1, -0.5, -0.2, 0.2, 0.5, 1];

  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
      <span>{formatPercentAxis(-cap)}</span>
      <span
        className="flex h-2 overflow-hidden rounded-full"
        aria-hidden="true"
      >
        {steps.map((step) => (
          <span
            key={step}
            className="h-full w-4"
            style={{
              backgroundColor: heatTint(step * cap, cap, "var(--muted)"),
            }}
          />
        ))}
      </span>
      <span>+{formatPercentAxis(cap)}</span>
    </div>
  );
}

export type SortDirection = "asc" | "desc";

/** Header cell whose label toggles the table sort. */
export function SortableHead({
  label,
  active,
  direction,
  align = "left",
  onToggle,
  className,
}: {
  label: ReactNode;
  active: boolean;
  direction: SortDirection;
  align?: "left" | "right";
  onToggle: () => void;
  className?: string;
}) {
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <TableHead
      className={cn(
        "text-muted-foreground",
        align === "right" && "text-right",
        className,
      )}
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "group inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <Icon
          className={cn(
            "size-3.5 shrink-0 transition-opacity",
            active ? "opacity-100" : "opacity-40 group-hover:opacity-80",
          )}
          aria-hidden="true"
        />
      </button>
    </TableHead>
  );
}
