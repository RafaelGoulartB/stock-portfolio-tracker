import { describe, expect, it } from "vitest";
import {
  currentQuarter,
  formatQuarterLabel,
  formatQuarterTitle,
  quarterWindow,
  shiftQuarter,
  toQuarter,
} from "./quarters";

describe("toQuarter", () => {
  it("parses a quarter key", () => {
    expect(toQuarter("2026Q1")).toEqual({
      key: "2026Q1",
      year: 2026,
      quarter: 1,
    });
  });
});

describe("currentQuarter", () => {
  it("derives the quarter from a date", () => {
    expect(currentQuarter(new Date(2026, 0, 15))).toMatchObject({ quarter: 1 });
    expect(currentQuarter(new Date(2026, 6, 15))).toMatchObject({ quarter: 3 });
    expect(currentQuarter(new Date(2026, 11, 31))).toMatchObject({
      quarter: 4,
    });
  });
});

describe("shiftQuarter", () => {
  it("wraps across year boundaries", () => {
    const q1 = toQuarter("2026Q1");
    expect(shiftQuarter(q1, -1)).toEqual({
      key: "2025Q4",
      year: 2025,
      quarter: 4,
    });
    expect(shiftQuarter(q1, 4)).toEqual({
      key: "2027Q1",
      year: 2027,
      quarter: 1,
    });
  });
});

describe("quarterWindow", () => {
  it("returns count quarters ending at end, oldest first", () => {
    const window = quarterWindow(toQuarter("2026Q2"), 3);
    expect(window.map((q) => q.key)).toEqual(["2025Q4", "2026Q1", "2026Q2"]);
  });
});

describe("quarter labels", () => {
  it("renders short and full labels", () => {
    const q = toQuarter("2026Q1");
    expect(formatQuarterLabel(q)).toBe("Q1 26");
    expect(formatQuarterTitle(q)).toBe("Q1 2026");
  });
});
