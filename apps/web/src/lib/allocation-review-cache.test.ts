import type { AssetReview } from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";
import type { RouterOutputs } from "@/lib/api";
import {
  findReview,
  removeReviewFromList,
  restoreReviewInList,
  reviewFromUpsertInput,
  upsertReviewInList,
} from "./allocation-review-cache";

type AllocationListData = RouterOutputs["allocation"]["list"];

function review(period: string, grade: string | null): AssetReview {
  return {
    period,
    grade,
    notes: null,
    fairValue: null,
    fairValueRef: null,
    watchNext: false,
  };
}

function makeData(reviews: AssetReview[]): AllocationListData {
  return {
    rows: [{ ticker: "PETR4", reviews }],
  } as unknown as AllocationListData;
}

describe("reviewFromUpsertInput", () => {
  it("keeps previous values for fields the input omits", () => {
    const previous = review("2026Q1", "8");
    const merged = reviewFromUpsertInput(
      { ticker: "PETR4", period: "2026Q1", notes: "updated" },
      previous,
    );

    expect(merged.grade).toBe("8");
    expect(merged.notes).toBe("updated");
    expect(merged.watchNext).toBe(false);
  });

  it("defaults missing fields when there is no previous review", () => {
    const merged = reviewFromUpsertInput(
      { ticker: "PETR4", period: "2026Q1" },
      undefined,
    );

    expect(merged).toEqual(review("2026Q1", null));
  });
});

describe("findReview", () => {
  it("locates a review by ticker and period", () => {
    const data = makeData([review("2026Q1", "8"), review("2026Q2", "7")]);

    expect(findReview(data, "PETR4", "2026Q2")?.grade).toBe("7");
    expect(findReview(data, "PETR4", "2099Q1")).toBeUndefined();
    expect(findReview(undefined, "PETR4", "2026Q1")).toBeUndefined();
  });
});

describe("upsertReviewInList", () => {
  it("replaces an existing quarter and keeps chronological order", () => {
    const data = makeData([review("2026Q1", "8")]);
    const updated = upsertReviewInList(data, "PETR4", review("2026Q1", "9"));
    const inserted = upsertReviewInList(
      updated,
      "PETR4",
      review("2025Q4", "7"),
    );

    const periods = inserted?.rows[0]?.reviews.map((r) => r.period);
    expect(periods).toEqual(["2025Q4", "2026Q1"]);
    expect(findReview(inserted, "PETR4", "2026Q1")?.grade).toBe("9");
  });

  it("returns the data unchanged when it is undefined", () => {
    expect(
      upsertReviewInList(undefined, "PETR4", review("2026Q1", "8")),
    ).toBeUndefined();
  });
});

describe("removeReviewFromList", () => {
  it("drops one quarter and leaves the rest", () => {
    const data = makeData([review("2026Q1", "8"), review("2026Q2", "7")]);
    const result = removeReviewFromList(data, "PETR4", "2026Q1");

    expect(result?.rows[0]?.reviews.map((r) => r.period)).toEqual(["2026Q2"]);
  });
});

describe("restoreReviewInList", () => {
  it("re-inserts a previous review when one existed", () => {
    const data = makeData([review("2026Q1", "9")]);
    const restored = restoreReviewInList(
      data,
      "PETR4",
      "2026Q1",
      review("2026Q1", "8"),
    );

    expect(findReview(restored, "PETR4", "2026Q1")?.grade).toBe("8");
  });

  it("removes the review when there was no previous value", () => {
    const data = makeData([review("2026Q1", "9")]);
    const restored = restoreReviewInList(data, "PETR4", "2026Q1", undefined);

    expect(restored?.rows[0]?.reviews).toEqual([]);
  });
});
