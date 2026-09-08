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
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDecimalInput, parseDecimalInput } from "@/lib/numeric-input";
import { cn } from "@/lib/utils";

export type ReviewSaveInput = {
  ticker: string;
  period: string;
  grade: string | null;
  notes: string | null;
  fairValue: string | null;
  fairValueRef: string | null;
  watchNext: boolean;
};

export function ReviewEditorForm({
  ticker,
  period,
  review,
  saving = false,
  layout = "compact",
  showHint = true,
  onSave,
  onRemove,
  onCancel,
}: {
  ticker: string;
  period: string;
  review: AssetReview | undefined;
  saving?: boolean;
  layout?: "compact" | "wide";
  showHint?: boolean;
  onSave: (input: ReviewSaveInput) => void;
  onRemove: (input: { ticker: string; period: string }) => void;
  onCancel?: () => void;
}) {
  const { i18n } = useLingui();
  const fieldId = `${ticker}-${period}`;
  const wide = layout === "wide";
  const [grade, setGrade] = useState(
    formatDecimalInput(review?.grade ?? null, i18n.locale),
  );
  const [notes, setNotes] = useState(review?.notes ?? "");
  const [fairValue, setFairValue] = useState(
    formatDecimalInput(review?.fairValue ?? null, i18n.locale),
  );
  const [fairValueRef, setFairValueRef] = useState(review?.fairValueRef ?? "");
  const [watchNext, setWatchNext] = useState(review?.watchNext ?? false);
  const [invalidGrade, setInvalidGrade] = useState(false);
  const [invalidFairValue, setInvalidFairValue] = useState(false);
  const [invalidFairValueRef, setInvalidFairValueRef] = useState(false);

  const hasFairValueRef = (review?.fairValueRef ?? "").trim().length > 0;

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
      parsedFairValueRef === null &&
      !watchNext
    ) {
      if (review) {
        onRemove({ ticker, period });
      }

      return;
    }

    onSave({
      ticker,
      period,
      grade: parsedGrade,
      notes: trimmedNotes.length === 0 ? null : trimmedNotes,
      fairValue: parsedFairValue,
      fairValueRef: parsedFairValueRef,
      watchNext,
    });
  }

  const fields = (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`grade-${fieldId}`} className="text-xs">
          <Trans id="allocation.reviewGrade">Grade (0–10)</Trans>
        </Label>
        <Input
          id={`grade-${fieldId}`}
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
        <Label htmlFor={`fair-value-${fieldId}`} className="text-xs">
          <Trans id="allocation.reviewFairValue">Fair value</Trans>
        </Label>
        <Input
          id={`fair-value-${fieldId}`}
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
        <Label htmlFor={`fair-value-ref-${fieldId}`} className="text-xs">
          <Trans id="allocation.reviewFairValueRef">Reference link</Trans>
        </Label>
        <Input
          id={`fair-value-ref-${fieldId}`}
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
    </>
  );

  const notesField = (
    <div className={cn("space-y-1.5", wide && "flex min-h-0 flex-col")}>
      <Label htmlFor={`notes-${fieldId}`} className="text-xs">
        <Trans id="allocation.reviewNotes">Notes</Trans>
      </Label>
      <Textarea
        id={`notes-${fieldId}`}
        value={notes}
        rows={wide ? 8 : 4}
        placeholder={i18n._(
          t({
            id: "allocation.reviewNotesPlaceholder",
            message: "What happened in the quarter?",
          }),
        )}
        className={cn("text-sm", wide ? "min-h-40 flex-1" : "max-h-56")}
        onChange={(event) => setNotes(event.target.value)}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {showHint ? (
        <p className="text-xs text-muted-foreground">
          <Trans id="allocation.reviewHint">
            The average of the newest graded quarters scales the score. Fair
            value feeds the discount from the newest quarter that has one.
          </Trans>
        </p>
      ) : null}

      {wide ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">{fields}</div>
          {notesField}
        </div>
      ) : (
        <>
          {fields}
          {notesField}
        </>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={`watch-next-${fieldId}`} className="text-xs">
            <Trans id="allocation.reviewWatchNext">Watch next quarter</Trans>
          </Label>
          <p className="text-[11px] leading-snug text-muted-foreground">
            <Trans id="allocation.reviewWatchNextHelp">
              Flags the next quarter so you remember to follow this thesis.
            </Trans>
          </p>
        </div>
        <Switch
          id={`watch-next-${fieldId}`}
          checked={watchNext}
          onCheckedChange={setWatchNext}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!review || saving}
          onClick={() => onRemove({ ticker, period })}
        >
          <Trans id="allocation.reviewClear">Clear</Trans>
        </Button>
        <div className="flex items-center gap-2">
          {onCancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={onCancel}
            >
              <Trans id="common.cancel">Cancel</Trans>
            </Button>
          ) : null}
          <Button type="button" size="sm" disabled={saving} onClick={save}>
            <Trans id="allocation.reviewSave">Save</Trans>
          </Button>
        </div>
      </div>
    </div>
  );
}
