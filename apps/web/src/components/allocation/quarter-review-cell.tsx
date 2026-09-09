import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import type { AssetReview } from "@portifolio-tracker/shared";
import { Eye, Maximize2, Minimize2 } from "lucide-react";
import { memo, useState } from "react";
import {
  ReviewEditorForm,
  type ReviewSaveInput,
} from "@/components/allocation/review-editor-form";
import { Button } from "@/components/ui/button";
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
 * Quarter quality as a traffic-light wash. Breakpoints match the default
 * score bands (`0`–`3`, `4`–`6`, `7`, `8`+): red, yellow, then green, with
 * an `8` reading stronger than a `7`. `--muted` is not a grade color — it
 * disappeared against the table.
 */
export function gradeToneClass(grade: string | null): string {
  if (grade === null) {
    return "";
  }

  const value = Number(grade);

  if (value >= 8) {
    return "bg-gain/35";
  }

  if (value >= 7) {
    return "bg-gain/22";
  }

  if (value >= 4) {
    return "bg-caution/48";
  }

  return "bg-loss/28";
}

/**
 * Accent classes for the watch-next bridge. They follow the grade of the
 * quarter that raised the flag, so a yellow `6` does not grow a gold bar.
 */
export function gradeWatchTone(grade: string | null): {
  bar: string;
  wash: string;
  icon: string;
  text: string;
  badge: string;
} {
  const value = grade === null ? Number.NaN : Number(grade);

  if (value >= 7) {
    return {
      bar: "bg-gain",
      wash: "bg-gain/20",
      icon: "text-gain",
      text: "text-gain",
      badge: "border-gain/45 text-gain",
    };
  }

  if (value >= 4) {
    return {
      bar: "bg-caution",
      wash: "bg-caution/25",
      icon: "text-caution",
      text: "text-caution",
      badge: "border-caution/45 text-caution",
    };
  }

  if (Number.isFinite(value)) {
    return {
      bar: "bg-loss",
      wash: "bg-loss/20",
      icon: "text-loss",
      text: "text-loss",
      badge: "border-loss/45 text-loss",
    };
  }

  return {
    bar: "bg-foreground/50",
    wash: "bg-accent",
    icon: "text-foreground/70",
    text: "text-muted-foreground",
    badge: "border-border text-muted-foreground",
  };
}

export type QuarterReviewCellProps = {
  ticker: string;
  quarter: Quarter;
  review: AssetReview | undefined;
  /**
   * True when the previous quarter's review asked to watch this cell. The
   * marker lives on that earlier review; this cell only renders it.
   */
  watched?: boolean;
  /** Grade of the quarter that raised {@link watched}, for matching color. */
  watchedGrade?: string | null;
  saving?: boolean;
  onSave: (input: ReviewSaveInput) => void;
  onRemove: (input: { ticker: string; period: string }) => void;
};

/**
 * One cell of the quarter grid: the grade colours the cell, adjacent dots
 * distinguish notes/supporting content from fair value, and clicking opens
 * the editor.
 *
 * Watching the next quarter is a static bridge, not a pulse: a bar on the
 * right of the source cell and a matching bar (plus wash/icon) on the left
 * of the following cell, both in that review's grade color.
 */
function QuarterReviewCellComponent({
  ticker,
  quarter,
  review,
  watched = false,
  watchedGrade = null,
  saving = false,
  onSave,
  onRemove,
}: QuarterReviewCellProps) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const hasNotes = (review?.notes ?? "").trim().length > 0;
  const hasFairValue = review?.fairValue != null;
  const hasFairValueRef = (review?.fairValueRef ?? "").trim().length > 0;
  const hasMarker = hasNotes || hasFairValue || hasFairValueRef;
  const hasNoteMarker = hasNotes || (hasFairValueRef && !hasFairValue);
  const watchNext = review?.watchNext === true;
  const emptyWatched = watched && review?.grade == null;
  const sourceTone = gradeWatchTone(review?.grade ?? null);
  const watchedTone = gradeWatchTone(watchedGrade);
  const title = `${ticker} · ${formatQuarterTitle(quarter)}`;
  const watchHint = watchNext
    ? i18n._(
        t({
          id: "allocation.reviewWatchNextHint",
          message: "Watch next quarter",
        }),
      )
    : watched
      ? i18n._(
          t({
            id: "allocation.reviewWatchedHint",
            message: "Flagged last quarter for attention",
          }),
        )
      : null;
  const expandLabel = i18n._(
    t({ id: "allocation.reviewExpand", message: "Expand editor" }),
  );
  const collapseLabel = i18n._(
    t({ id: "allocation.reviewCollapse", message: "Collapse editor" }),
  );
  const fairValueHint = i18n._(
    t({ id: "allocation.reviewFairValueSet", message: "Fair value set" }),
  );
  const markerDetails = [
    watchHint,
    hasNotes ? review?.notes : null,
    hasFairValue ? fairValueHint : null,
  ].filter((detail): detail is string => !!detail);
  const triggerLabel =
    markerDetails.length > 0
      ? `${title} — ${markerDetails.join(" · ")}`
      : title;

  function closeEditor() {
    setOpen(false);
    setExpanded(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          setExpanded(false);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={
            markerDetails.length > 0
              ? triggerLabel
              : `${title} — ${i18n._(t({ id: "allocation.reviewEdit", message: "Grade this quarter" }))}`
          }
          aria-label={triggerLabel}
          className={cn(
            "relative h-7 w-full rounded-sm text-center text-xs font-medium tabular-nums transition-colors hover:ring-1 hover:ring-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            gradeToneClass(review?.grade ?? null),
            review?.grade == null && hasMarker && "bg-accent",
            emptyWatched && watchedTone.wash,
            !review && !watched && "hover:bg-accent",
          )}
        >
          {review?.grade == null ? (
            emptyWatched ? (
              <Eye
                aria-hidden="true"
                className={cn("mx-auto size-3.5", watchedTone.icon)}
              />
            ) : null
          ) : (
            formatDecimalInput(review.grade, i18n.locale)
          )}
          {hasNoteMarker || hasFairValue ? (
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 flex items-center -space-x-px"
            >
              {hasNoteMarker ? (
                <span className="size-1.5 rounded-full bg-foreground/45" />
              ) : null}
              {hasFairValue ? (
                <span className="size-1.5 rounded-full bg-primary/80" />
              ) : null}
            </span>
          ) : null}
          {watchNext ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-1 -right-px w-1 rounded-full",
                sourceTone.bar,
              )}
            />
          ) : null}
          {watched ? (
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-y-1 -left-px w-1 rounded-full",
                watchedTone.bar,
              )}
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        className={cn(
          "space-y-3 overflow-y-auto",
          expanded
            ? "w-[min(52rem,calc(100vw-2rem))] max-h-[min(42rem,calc(100dvh-2rem))]"
            : "w-80 max-h-[min(32rem,calc(100dvh-2rem))]",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-semibold">{title}</p>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-expanded={expanded}
            aria-label={expanded ? collapseLabel : expandLabel}
            title={expanded ? collapseLabel : expandLabel}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? (
              <Minimize2 aria-hidden="true" />
            ) : (
              <Maximize2 aria-hidden="true" />
            )}
          </Button>
        </div>
        {watched && !watchNext ? (
          <p className={cn("text-xs", watchedTone.text)}>{watchHint}</p>
        ) : null}
        <ReviewEditorForm
          ticker={ticker}
          period={quarter.key}
          review={review}
          saving={saving}
          layout={expanded ? "wide" : "compact"}
          onSave={(input) => {
            onSave(input);
            closeEditor();
          }}
          onRemove={(input) => {
            onRemove(input);
            closeEditor();
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Memoized: the quarter grid renders `rows x quarters` cells, so a container
 * re-render (typing in the search box, re-sorting) would otherwise rebuild all
 * of them even though a cell only depends on its own review.
 */
export const QuarterReviewCell = memo(QuarterReviewCellComponent);
