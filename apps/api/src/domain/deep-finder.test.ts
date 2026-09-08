import { describe, expect, it } from "vitest";
import {
  finderSeriesStart,
  seriesLookbackStart,
  shiftIsoDate,
  shiftIsoMonth,
  windowStartDay,
} from "./deep-finder";

describe("windowStartDay", () => {
  const today = "2026-09-06";

  it("has no start on the cost window", () => {
    expect(windowStartDay("cost", today)).toBeNull();
  });

  it("steps back one calendar day for 1d", () => {
    expect(windowStartDay("1d", today)).toBe("2026-09-05");
  });

  it("steps back a week", () => {
    expect(windowStartDay("1w", today)).toBe("2026-08-30");
  });

  it("steps back one month", () => {
    expect(windowStartDay("1m", today)).toBe("2026-08-06");
  });

  it("steps back a year", () => {
    expect(windowStartDay("1y", today)).toBe("2025-09-06");
  });

  it("anchors YTD to last year's final calendar day", () => {
    expect(windowStartDay("ytd", today)).toBe("2025-12-31");
  });
});

describe("shiftIsoDate", () => {
  it("crosses month boundaries", () => {
    expect(shiftIsoDate("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("shiftIsoMonth", () => {
  it("keeps the day when the previous month has it", () => {
    expect(shiftIsoMonth("2026-09-06", -3)).toBe("2026-06-06");
  });
});

describe("seriesLookbackStart", () => {
  it("pads ten days before the window so weekends still resolve", () => {
    expect(seriesLookbackStart("2026-09-05")).toBe("2026-08-26");
  });
});

describe("finderSeriesStart", () => {
  it("uses distinct ranges for ordinary finder windows", () => {
    expect(finderSeriesStart("1d", "2026-09-06")).toBe("2026-08-26");
    expect(finderSeriesStart("1m", "2026-09-06")).toBe("2026-07-27");
  });

  it("uses one stable range when windows share the provider cache", () => {
    const expected = "2025-08-27";

    expect(finderSeriesStart("1d", "2026-09-06", true)).toBe(expected);
    expect(finderSeriesStart("3m", "2026-09-06", true)).toBe(expected);
    expect(finderSeriesStart("1y", "2026-09-06", true)).toBe(expected);
  });
});
