import type { Currency } from "@portifolio-tracker/shared";
import { formatMoney, formatSignedMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Zero amounts read better without a sign. */
export function signedOrZero(value: string, currency: Currency): string {
  return Number(value) === 0
    ? formatMoney(value, currency)
    : formatSignedMoney(value, currency);
}

/**
 * One bar on a full-width track. The track is the comparison baseline, so
 * every bar of a list has to share the same track width — keep the wrapper
 * flexible and let the grid column decide how wide that is.
 */
export function ShareBar({
  fraction,
  color,
  className,
}: {
  fraction: number;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block h-2 overflow-hidden rounded-[3px] bg-muted",
        className,
      )}
      aria-hidden="true"
    >
      <span
        className={cn("block h-full rounded-r-[3px]", !color && "bg-chart-1")}
        style={{
          // A sliver keeps sub-percent rows visible instead of blank.
          width: `${Math.max(fraction * 100, 1.2)}%`,
          backgroundColor: color,
        }}
      />
    </span>
  );
}
