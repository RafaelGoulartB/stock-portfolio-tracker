export type SnapshotMonth = {
  /** `YYYY-MM` key for selection state. */
  key: string;
  year: number;
  /** Zero-based month index. */
  month: number;
  /**
   * Snapshot date (`YYYY-MM-DD`, last day of the month) or `null` for the
   * current month, which always shows the live portfolio today.
   */
  asOf: string | null;
  current: boolean;
};

/**
 * Twelve snapshot entries ending in the current month, newest first.
 * Calendar month boundaries are identical in every timezone, so UTC date
 * math is safe here.
 */
export function lastTwelveMonths(now: Date = new Date()): SnapshotMonth[] {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const months: SnapshotMonth[] = [];

  for (let back = 0; back < 12; back += 1) {
    const first = new Date(base);
    first.setUTCMonth(first.getUTCMonth() - back);

    const year = first.getUTCFullYear();
    const month = first.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;

    months.push({
      key,
      year,
      month,
      asOf: back === 0 ? null : `${key}-${String(lastDay).padStart(2, "0")}`,
      current: back === 0,
    });
  }

  return months;
}

/** Short month label (`Sep 2026`) in the active UI locale. */
export function formatMonthLabel(
  month: Pick<SnapshotMonth, "year" | "month">,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(month.year, month.month, 1)));
}
