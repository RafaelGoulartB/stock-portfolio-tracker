import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AssetReview } from "@portifolio-tracker/shared";
import { GRADE_MAX, GRADE_MIN } from "@portifolio-tracker/shared";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatDecimalInput, parseDecimalInput } from "@/lib/numeric-input";
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
  onSave: (input: {
    ticker: string;
    period: string;
    grade: string | null;
    notes: string | null;
  }) => void;
  onRemove: (input: { ticker: string; period: string }) => void;
};

/**
 * One cell of the quarter grid: the grade colours the cell, a dot marks
 * stored notes, and clicking opens the editor for both.
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
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");
  const [invalid, setInvalid] = useState(false);

  // The editor is seeded on open, so an incoming refetch never overwrites
  // what is being typed.
  useEffect(() => {
    if (open) {
      setGrade(formatDecimalInput(review?.grade ?? null, i18n.locale));
      setNotes(review?.notes ?? "");
      setInvalid(false);
    }
  }, [open, review?.grade, review?.notes, i18n.locale]);

  const hasNotes = (review?.notes ?? "").trim().length > 0;
  const title = `${ticker} · ${formatQuarterTitle(quarter)}`;

  function save() {
    const parsed = grade.trim().length === 0 ? null : parseDecimalInput(grade);

    if (
      grade.trim().length > 0 &&
      (parsed === null ||
        Number(parsed) < GRADE_MIN ||
        Number(parsed) > GRADE_MAX)
    ) {
      setInvalid(true);

      return;
    }

    const trimmedNotes = notes.trim();

    if (parsed === null && trimmedNotes.length === 0) {
      if (review) {
        onRemove({ ticker, period: quarter.key });
      }

      setOpen(false);

      return;
    }

    onSave({
      ticker,
      period: quarter.key,
      grade: parsed,
      notes: trimmedNotes.length === 0 ? null : trimmedNotes,
    });
    setOpen(false);
  }

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
            review?.grade == null && hasNotes && "bg-accent",
            !review && "hover:bg-accent",
          )}
        >
          {review?.grade == null
            ? null
            : formatDecimalInput(review.grade, i18n.locale)}
          {hasNotes ? (
            <span
              aria-hidden="true"
              className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-foreground/50"
            />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-72 space-y-3">
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">
            <Trans id="allocation.reviewHint">
              The average of the newest graded quarters scales the score.
            </Trans>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`grade-${ticker}-${quarter.key}`} className="text-xs">
            <Trans id="allocation.reviewGrade">Grade (0–10)</Trans>
          </Label>
          <Input
            id={`grade-${ticker}-${quarter.key}`}
            value={grade}
            inputMode="decimal"
            aria-invalid={invalid}
            placeholder="8"
            className="h-8"
            onChange={(event) => {
              setGrade(event.target.value);
              setInvalid(false);
            }}
          />
          {invalid ? (
            <p className="text-xs text-destructive">
              <Trans id="allocation.reviewGradeInvalid">
                Use a grade between 0 and 10.
              </Trans>
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`notes-${ticker}-${quarter.key}`} className="text-xs">
            <Trans id="allocation.reviewNotes">Notes</Trans>
          </Label>
          <Textarea
            id={`notes-${ticker}-${quarter.key}`}
            value={notes}
            rows={4}
            placeholder={i18n._(
              t({
                id: "allocation.reviewNotesPlaceholder",
                message: "What happened in the quarter?",
              }),
            )}
            className="max-h-56 text-sm"
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!review || saving}
            onClick={() => {
              onRemove({ ticker, period: quarter.key });
              setOpen(false);
            }}
          >
            <Trans id="allocation.reviewClear">Clear</Trans>
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={save}>
            <Trans id="allocation.reviewSave">Save</Trans>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
