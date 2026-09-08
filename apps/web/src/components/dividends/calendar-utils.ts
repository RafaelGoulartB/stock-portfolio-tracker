import { i18n } from "@/i18n";
import { formatTradeDate } from "@/lib/format";
import type { DividendEvent } from "./types";

export function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function eventDay(event: DividendEvent): string {
  return event.paymentDate ?? event.exDate;
}

export function formatOptionalDate(day: string | null): string {
  return day ? formatTradeDate(day) : "—";
}

export function monthLabel(
  month: string,
  width: "short" | "long" = "short",
): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(i18n.locale, {
    month: width,
    year: width === "long" ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function weekdays(): string[] {
  const formatter = new Intl.DateTimeFormat(i18n.locale, {
    weekday: "short",
    timeZone: "UTC",
  });
  const sunday = new Date(Date.UTC(2024, 0, 7));

  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(sunday);
    day.setUTCDate(sunday.getUTCDate() + index);
    return formatter.format(day);
  });
}

export function moveMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function calendarCells(
  month: string,
): Array<{ day: string; inMonth: boolean }> {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      day: date.toISOString().slice(0, 10),
      inMonth: date.getUTCMonth() === monthNumber - 1,
    };
  });
}
