import type { AllocationMarkColor } from "@portifolio-tracker/shared";

export const FOCUS_QUARTERS_KEY = "portfolio.allocation.focusQuarters";
export const FOCUS_QUARTER_COL = "bg-blue-400/[0.04]";

/**
 * Soft mark tint mixed into `--card` so sticky ticker and the rest of the
 * row share the same opaque wash. Hover deepens the same hue slightly
 * instead of swapping to muted grey.
 */
export const MARK_ROW: Record<AllocationMarkColor, string> = {
  blue: "bg-[color-mix(in_oklab,var(--color-blue-400)_7%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-blue-400)_10%,var(--card))]",
  yellow:
    "bg-[color-mix(in_oklab,var(--color-yellow-400)_10%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-yellow-400)_13%,var(--card))]",
  red: "bg-[color-mix(in_oklab,var(--color-red-400)_7%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-red-400)_10%,var(--card))]",
  orange:
    "bg-[color-mix(in_oklab,var(--color-orange-400)_10%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-orange-400)_13%,var(--card))]",
  green:
    "bg-[color-mix(in_oklab,var(--color-green-400)_7%,var(--card))] hover:bg-[color-mix(in_oklab,var(--color-green-400)_10%,var(--card))]",
};

/** Same wash as {@link MARK_ROW}, driven by `group-hover` for the sticky cell. */
export const MARK_STICKY: Record<AllocationMarkColor, string> = {
  blue: "bg-[color-mix(in_oklab,var(--color-blue-400)_7%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-blue-400)_10%,var(--card))]",
  yellow:
    "bg-[color-mix(in_oklab,var(--color-yellow-400)_10%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-yellow-400)_13%,var(--card))]",
  red: "bg-[color-mix(in_oklab,var(--color-red-400)_7%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-red-400)_10%,var(--card))]",
  orange:
    "bg-[color-mix(in_oklab,var(--color-orange-400)_10%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-orange-400)_13%,var(--card))]",
  green:
    "bg-[color-mix(in_oklab,var(--color-green-400)_7%,var(--card))] group-hover:bg-[color-mix(in_oklab,var(--color-green-400)_10%,var(--card))]",
};

export const MARK_DOT: Record<AllocationMarkColor, string> = {
  blue: "bg-blue-400",
  yellow: "bg-yellow-400",
  red: "bg-red-400",
  orange: "bg-orange-400",
  green: "bg-green-400",
};

export function initialFocusQuarters(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(FOCUS_QUARTERS_KEY) ?? "null",
    );

    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value) => typeof value === "string"));
    }
  } catch {
    // Storage is only a convenience; nothing is focused by default.
  }

  return new Set();
}
