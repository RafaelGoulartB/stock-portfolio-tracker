import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import type { AssetReview } from "@portifolio-tracker/shared";
import { useState } from "react";
import {
  ReviewEditorForm,
  type ReviewSaveInput,
} from "@/components/allocation/review-editor-form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatDecimalInput } from "@/lib/numeric-input";
import type { Quarter } from "@/lib/quarters";
import { formatQuarterTitle } from "@/lib/quarters";
import { cn } from "@/lib/utils";

/**
 * Quarter quality, as a background tone. Built from the `--gain` / `--loss`
 * tokens so the scale keeps working in both themes: the bands mirror the
 * grade bands the score engine uses, which is why a `7` reads weaker than
 * an `8` at a glance.
 */
export function gradeToneClass(grade: string | null): string {
  if (grade === null) {
    return "";
  }

  const value = Number(grade);

  if (value >= 8) {
    return "bg-gain/30";
  }

  if (value >= 7) {
    return "bg-gain/15";
  }

  if (value >= 4) {
    return "bg-muted";
  }

  return "bg-loss/20";
}

export type QuarterReviewCellProps = {
  ticker: string;
  quarter: Quarter;
  review: AssetReview | undefined;
  saving?: boolean;
  onSave: (input: ReviewSaveInput) => void;
  onRemove: (input: { ticker: string; period: string }) => void;
};

/**
 * One cell of the quarter grid: the grade colours the cell, a dot marks
 * stored notes or a fair value, and clicking opens the editor.
 */
export function QuarterReviewCell({
  ticker,
  quarter,
  review,
  saving = false,
  onSave,
  onRemove,
}: QuarterReviewCellProps) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);

  const hasNotes = (review?.notes ?? "").trim().length > 0;
  const hasFairValue = review?.fairValue != null;
  const hasFairValueRef = (review?.fairValueRef ?? "").trim().length > 0;
  const hasMarker = hasNotes || hasFairValue || hasFairValueRef;
  const title = `${ticker} · ${formatQuarterTitle(quarter)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={
            hasNotes
              ? `${title} — ${review?.notes ?? ""}`
              : `${title} — ${i18n._(t({ id: "allocation.reviewEdit", message: "Grade this quarter" }))}`
          }
          aria-label={title}
          className={cn(
            "relative h-7 w-full rounded-sm text-center text-xs font-medium tabular-nums transition-colors hover:ring-1 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            gradeToneClass(review?.grade ?? null),
            review?.grade == null && hasMarker && "bg-accent",
            !review && "hover:bg-accent",
          )}
        >
          {review?.grade == null
            ? null
            : formatDecimalInput(review.grade, i18n.locale)}
          {hasMarker ? (
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-foreground/50"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-80 space-y-3">
        <p className="text-sm font-semibold">{title}</p>
        <ReviewEditorForm
          ticker={ticker}
          period={quarter.key}
          review={review}
          saving={saving}
          onSave={(input) => {
            onSave(input);
            setOpen(false);
          }}
          onRemove={(input) => {
            onRemove(input);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
