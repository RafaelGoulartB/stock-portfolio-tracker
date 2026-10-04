/**
 * Diverging heat for a signed ratio: `--gain` above zero, `--loss` below,
 * nothing at zero. Intensity grows linearly with `|value| / cap` and is
 * capped, so one outlier does not wash out every other cell. The strongest
 * tint stays light enough for foreground text to keep its contrast.
 *
 * Mixing happens in OKLab, not OKLCH: a polar space would interpolate the
 * hue and turn red over a bluish surface into purple.
 */
const MIN_TINT = 10;
const MAX_TINT = 64;

export function heatTint(
  value: number | null,
  cap: number,
  /** Color the tint mixes into; opaque surfaces such as SVG tiles need one. */
  base = "transparent",
): string | undefined {
  if (value == null || !Number.isFinite(value) || value === 0 || cap <= 0) {
    return undefined;
  }

  const intensity = Math.min(Math.abs(value) / cap, 1);
  const tint = Math.round(MIN_TINT + intensity * (MAX_TINT - MIN_TINT));
  const token = value > 0 ? "--gain" : "--loss";

  return `color-mix(in oklab, var(${token}) ${tint}%, ${base})`;
}
