import { describe, expect, it } from "vitest";
import { formatMonthLabel, lastTwelveMonths } from "./months";

describe("lastTwelveMonths", () => {
  const months = lastTwelveMonths(new Date(Date.UTC(2026, 8, 15)));

  it("returns twelve entries ending in the current month, newest first", () => {
    expect(months).toHaveLength(12);
    expect(months[0]?.key).toBe("2026-09");
    expect(months[11]?.key).toBe("2025-10");
  });

  it("marks only the current month as live with a null snapshot date", () => {
    expect(months[0]).toMatchObject({ current: true, asOf: null });
    expect(months[1]).toMatchObject({ current: false });
  });

  it("uses the last calendar day for past-month snapshots", () => {
    const february = months.find((m) => m.key === "2026-02");
    expect(february?.asOf).toBe("2026-02-28");
  });
});

describe("formatMonthLabel", () => {
  it("renders a short month label in the given locale", () => {
    expect(formatMonthLabel({ year: 2026, month: 8 }, "en")).toBe("Sep 2026");
  });
});
