import type {
  AssetReview,
  UpsertAssetReviewInput,
} from "@portifolio-tracker/shared";
import type { RouterOutputs } from "@/lib/api";

type AllocationListData = RouterOutputs["allocation"]["list"];

/** Build the review the grid should show before the server answers. */
export function reviewFromUpsertInput(
  input: UpsertAssetReviewInput,
  previous: AssetReview | undefined,
): AssetReview {
  return {
    period: input.period,
    grade: input.grade !== undefined ? input.grade : (previous?.grade ?? null),
    notes: input.notes !== undefined ? input.notes : (previous?.notes ?? null),
    fairValue:
      input.fairValue !== undefined
        ? input.fairValue
        : (previous?.fairValue ?? null),
    fairValueRef:
      input.fairValueRef !== undefined
        ? input.fairValueRef
        : (previous?.fairValueRef ?? null),
    watchNext:
      input.watchNext !== undefined
        ? input.watchNext
        : (previous?.watchNext ?? false),
  };
}

export function findReview(
  data: AllocationListData | undefined,
  ticker: string,
  period: string,
): AssetReview | undefined {
  return data?.rows
    .find((row) => row.ticker === ticker)
    ?.reviews.find((review) => review.period === period);
}

/** Insert or replace one quarterly review on a ticker row. */
export function upsertReviewInList(
  data: AllocationListData | undefined,
  ticker: string,
  review: AssetReview,
): AllocationListData | undefined {
  if (!data) {
    return data;
  }

  return {
    ...data,
    rows: data.rows.map((row) => {
      if (row.ticker !== ticker) {
        return row;
      }

      const reviews = [
        ...row.reviews.filter((entry) => entry.period !== review.period),
        review,
      ].sort((a, b) => a.period.localeCompare(b.period));

      return { ...row, reviews };
    }),
  };
}

/** Drop one quarterly review; other tickers stay untouched. */
export function removeReviewFromList(
  data: AllocationListData | undefined,
  ticker: string,
  period: string,
): AllocationListData | undefined {
  if (!data) {
    return data;
  }

  return {
    ...data,
    rows: data.rows.map((row) => {
      if (row.ticker !== ticker) {
        return row;
      }

      return {
        ...row,
        reviews: row.reviews.filter((entry) => entry.period !== period),
      };
    }),
  };
}

/**
 * Undo one review write without wiping concurrent optimistic edits on
 * other quarters or tickers.
 */
export function restoreReviewInList(
  data: AllocationListData | undefined,
  ticker: string,
  period: string,
  previous: AssetReview | undefined,
): AllocationListData | undefined {
  if (previous) {
    return upsertReviewInList(data, ticker, previous);
  }

  return removeReviewFromList(data, ticker, period);
}
