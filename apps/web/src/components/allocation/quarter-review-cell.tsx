import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AssetReview } from "@portifolio-tracker/shared";
import {
  fairValueRefSchema,
  fairValueSchema,
  GRADE_MAX,
  GRADE_MIN,
} from "@portifolio-tracker/shared";
import { ExternalLink } from "lucide-react";
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
    fairValue: string | null;
    fairValueRef: string | null;
  }) => void;
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
  const [grade, setGrade] = useState("");
  const [notes, setNotes] = useState("");
  const [fairValue, setFairValue] = useState("");
  const [fairValueRef, setFairValueRef] = useState("");
  const [invalidGrade, setInvalidGrade] = useState(false);
  const [invalidFairValue, setInvalidFairValue] = useState(false);
  const [invalidFairValueRef, setInvalidFairValueRef] = useState(false);

  // The editor is seeded on open, so an incoming refetch never overwrites
  // what is being typed.
  useEffect(() => {
    if (open) {
      setGrade(formatDecimalInput(review?.grade ?? null, i18n.locale));
      setNotes(review?.notes ?? "");
      setFairValue(formatDecimalInput(review?.fairValue ?? null, i18n.locale));
      setFairValueRef(review?.fairValueRef ?? "");
      setInvalidGrade(false);
      setInvalidFairValue(false);
      setInvalidFairValueRef(false);
    }
  }, [
    open,
    review?.grade,
    review?.notes,
    review?.fairValue,
    review?.fairValueRef,
    i18n.locale,
  ]);

  const hasNotes = (review?.notes ?? "").trim().length > 0;
  const hasFairValue = review?.fairValue != null;
  const hasFairValueRef = (review?.fairValueRef ?? "").trim().length > 0;
  const hasMarker = hasNotes || hasFairValue || hasFairValueRef;
  const title = `${ticker} · ${formatQuarterTitle(quarter)}`;

  function save() {
    const parsedGrade =
      grade.trim().length === 0 ? null : parseDecimalInput(grade);
    const parsedFairValue =
      fairValue.trim().length === 0 ? null : parseDecimalInput(fairValue);
    const trimmedRef = fairValueRef.trim();
    const parsedFairValueRef = trimmedRef.length === 0 ? null : trimmedRef;

    let hasError = false;

    if (
      grade.trim().length > 0 &&
      (parsedGrade === null ||
        Number(parsedGrade) < GRADE_MIN ||
        Number(parsedGrade) > GRADE_MAX)
    ) {
      setInvalidGrade(true);
      hasError = true;
    }

    if (
      fairValue.trim().length > 0 &&
      (parsedFairValue === null ||
        !fairValueSchema.safeParse(parsedFairValue).success)
    ) {
      setInvalidFairValue(true);
      hasError = true;
    }

    if (
      parsedFairValueRef !== null &&
      !fairValueRefSchema.safeParse(parsedFairValueRef).success
    ) {
      setInvalidFairValueRef(true);
      hasError = true;
    }

    if (hasError) {
      return;
    }

    const trimmedNotes = notes.trim();

    if (
      parsedGrade === null &&
      trimmedNotes.length === 0 &&
      parsedFairValue === null &&
      parsedFairValueRef === null
    ) {
      if (review) {
        onRemove({ ticker, period: quarter.key });
      }

      setOpen(false);

      return;
    }

    onSave({
      ticker,
      period: quarter.key,
      grade: parsedGrade,
      notes: trimmedNotes.length === 0 ? null : trimmedNotes,
      fairValue: parsedFairValue,
      fairValueRef: parsedFairValueRef,
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
        <div className="space-y-0.5">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">
            <Trans id="allocation.reviewHint">
              The average of the newest graded quarters scales the score. Fair
              value feeds the discount from the newest quarter that has one.
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
            aria-invalid={invalidGrade}
            placeholder="8"
            className="h-8"
            onChange={(event) => {
              setGrade(event.target.value);
              setInvalidGrade(false);
            }}
          />
          {invalidGrade ? (
            <p className="text-xs text-destructive">
              <Trans id="allocation.reviewGradeInvalid">
                Use a grade between 0 and 10.
              </Trans>
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor={`fair-value-${ticker}-${quarter.key}`}
            className="text-xs"
          >
            <Trans id="allocation.reviewFairValue">Fair value</Trans>
          </Label>
          <Input
            id={`fair-value-${ticker}-${quarter.key}`}
            value={fairValue}
            inputMode="decimal"
            aria-invalid={invalidFairValue}
            placeholder="45,50"
            className="h-8"
            onChange={(event) => {
              setFairValue(event.target.value);
              setInvalidFairValue(false);
            }}
          />
          {invalidFairValue ? (
            <p className="text-xs text-destructive">
              <Trans id="allocation.reviewFairValueInvalid">
                Use a positive fair value.
              </Trans>
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor={`fair-value-ref-${ticker}-${quarter.key}`}
            className="text-xs"
          >
            <Trans id="allocation.reviewFairValueRef">Reference link</Trans>
          </Label>
          <Input
            id={`fair-value-ref-${ticker}-${quarter.key}`}
            value={fairValueRef}
            inputMode="url"
            type="url"
            aria-invalid={invalidFairValueRef}
            placeholder="https://…"
            className="h-8"
            onChange={(event) => {
              setFairValueRef(event.target.value);
              setInvalidFairValueRef(false);
            }}
          />
          {invalidFairValueRef ? (
            <p className="text-xs text-destructive">
              <Trans id="allocation.reviewFairValueRefInvalid">
                Use a full http(s) link.
              </Trans>
            </p>
          ) : null}
          {hasFairValueRef && review?.fairValueRef ? (
            <a
              href={review.fairValueRef}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="size-3" aria-hidden="true" />
              <Trans id="allocation.reviewFairValueRefOpen">Open reference</Trans>
            </a>
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
