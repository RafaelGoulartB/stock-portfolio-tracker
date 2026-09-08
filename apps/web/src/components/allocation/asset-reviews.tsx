import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  type AllocationRow,
  type AssetReview,
  GRADE_MAX,
  parseQuarterKey,
  quarterEndDate,
} from "@portifolio-tracker/shared";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import {
  gradeToneClass,
  gradeWatchTone,
} from "@/components/allocation/quarter-review-cell";
import {
  ReviewEditorForm,
  type ReviewSaveInput,
} from "@/components/allocation/review-editor-form";
import { Badge } from "@/components/ui/badge";
import {
  formatMoney,
  formatSignedWeightPrecise,
  pnlClassName,
} from "@/lib/format";
import { formatDecimalInput } from "@/lib/numeric-input";
import { formatQuarterTitle, toQuarter } from "@/lib/quarters";
import { cn } from "@/lib/utils";

function closeOn(
  series: { asOf: string; close: string }[] | undefined,
  period: string,
): string | null {
  if (!series || series.length === 0) {
    return null;
  }

  const end = quarterEndDate(period);
  let close: string | null = null;

  for (const point of series) {
    if (point.asOf <= end) {
      close = point.close;
    }
  }

  return close;
}

function groupByYear(
  reviews: readonly AssetReview[],
): { year: number; reviews: AssetReview[] }[] {
  const groups: { year: number; reviews: AssetReview[] }[] = [];

  for (const review of reviews) {
    const { year } = parseQuarterKey(review.period);
    const current = groups.at(-1);

    if (current && current.year === year) {
      current.reviews.push(review);
    } else {
      groups.push({ year, reviews: [review] });
    }
  }

  return groups;
}

function gradeFillClass(grade: string | null): string {
  if (grade === null) {
    return "bg-muted-foreground/40";
  }

  const value = Number(grade);

  if (value >= 7) {
    return "bg-gain";
  }

  if (value >= 4) {
    return "bg-caution/75";
  }

  return "bg-loss";
}

/** Year-grouped quarter cards: grade, fair value, close discount and notes. */
export function AssetReviews({
  reviews,
  row,
  series,
  locale,
  saving = false,
  onSave,
  onRemove,
}: {
  reviews: AssetReview[];
  row: AllocationRow;
  series: { asOf: string; close: string }[] | undefined;
  locale: string;
  saving?: boolean;
  onSave: (input: ReviewSaveInput) => void;
  onRemove: (input: { ticker: string; period: string }) => void;
}) {
  const latestPeriod = reviews[0]?.period;
  const years = groupByYear(reviews);
  const [expandedPeriod, setExpandedPeriod] = useState<string | null>(null);

  useEffect(() => {
    if (
      expandedPeriod &&
      !reviews.some((review) => review.period === expandedPeriod)
    ) {
      setExpandedPeriod(null);
    }
  }, [expandedPeriod, reviews]);

  useEffect(() => {
    if (!expandedPeriod) {
      return;
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpandedPeriod(null);
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [expandedPeriod]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            <Trans id="allocation.detailReviews">Quarterly reviews</Trans>
          </h2>
          <p className="text-sm text-muted-foreground">
            <Trans id="allocation.detailReviewsHint">
              Click a quarter to expand and edit the grade, fair value and
              notes.
            </Trans>
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          <Trans id="allocation.detailReviewCount">
            {reviews.length} quarters
          </Trans>
        </p>
      </div>

      {years.map((group) => (
        <div key={group.year} className="space-y-2.5">
          <h3 className="text-sm font-medium text-muted-foreground">
            {group.year}
          </h3>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(15.5rem,1fr))]">
            {group.reviews.map((review) => (
              <ReviewCard
                key={review.period}
                review={review}
                row={row}
                close={closeOn(series, review.period)}
                locale={locale}
                latest={review.period === latestPeriod}
                expanded={expandedPeriod === review.period}
                saving={saving}
                onToggle={() =>
                  setExpandedPeriod((current) =>
                    current === review.period ? null : review.period,
                  )
                }
                onSave={onSave}
                onRemove={onRemove}
                onCollapse={() => setExpandedPeriod(null)}
              />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

function ReviewCard({
  review,
  row,
  close,
  locale,
  latest,
  expanded,
  saving,
  onToggle,
  onSave,
  onRemove,
  onCollapse,
}: {
  review: AssetReview;
  row: AllocationRow;
  close: string | null;
  locale: string;
  latest: boolean;
  expanded: boolean;
  saving: boolean;
  onToggle: () => void;
  onSave: (input: ReviewSaveInput) => void;
  onRemove: (input: { ticker: string; period: string }) => void;
  onCollapse: () => void;
}) {
  const { i18n } = useLingui();
  const quarter = toQuarter(review.period);
  const title = formatQuarterTitle(quarter);
  const discount =
    review.fairValue === null || close === null
      ? null
      : String(
          (Number(review.fairValue) - Number(close)) / Number(review.fairValue),
        );
  const gradeRatio =
    review.grade === null
      ? 0
      : Math.min(1, Math.max(0, Number(review.grade) / GRADE_MAX));

  const toggleLabel = `${title} — ${i18n._(
    t({
      id: "allocation.reviewEdit",
      message: "Grade this quarter",
    }),
  )}`;
  const watchTone = gradeWatchTone(review.grade);

  const header = (
    <header className="flex w-full min-w-0 items-start gap-2">
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-base font-semibold tracking-tight">{title}</p>
        {latest || review.watchNext ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {latest ? (
              <Badge variant="secondary" className="text-[10px]">
                <Trans id="allocation.detailLatestReview">Latest</Trans>
              </Badge>
            ) : null}
            {review.watchNext ? (
              <Badge
                variant="outline"
                className={cn(
                  "max-w-full min-w-0 whitespace-normal text-pretty leading-tight",
                  watchTone.badge,
                )}
              >
                <Trans id="allocation.reviewWatchNext">
                  Watch next quarter
                </Trans>
              </Badge>
            ) : null}
          </span>
        ) : null}
      </div>
      <ChevronDown
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out",
          expanded && "rotate-180",
        )}
      />
    </header>
  );

  const metrics = (
    <>
      <div className="flex items-end gap-3">
        {review.grade === null ? (
          <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed text-lg text-muted-foreground">
            —
          </div>
        ) : (
          <div
            className={cn(
              "flex size-14 shrink-0 items-center justify-center rounded-xl text-2xl font-semibold tabular-nums",
              gradeToneClass(review.grade),
            )}
          >
            {formatDecimalInput(review.grade, locale)}
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1.5 pb-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full",
                gradeFillClass(review.grade),
              )}
              style={{ width: `${Math.round(gradeRatio * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            <Trans id="allocation.colGrade">Grade</Trans>
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">
            <Trans id="allocation.colFairValue">Fair value</Trans>
          </dt>
          <dd className="mt-0.5 text-sm font-medium tabular-nums">
            {review.fairValue === null ? (
              <span className="font-normal text-muted-foreground">—</span>
            ) : (
              formatMoney(review.fairValue, row.currency)
            )}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">
            <Trans id="allocation.detailVsClose">vs close</Trans>
          </dt>
          <dd
            className={cn(
              "mt-0.5 text-sm font-medium tabular-nums",
              discount ? pnlClassName(discount) : "text-muted-foreground",
            )}
          >
            {discount === null ? "—" : formatSignedWeightPrecise(discount)}
          </dd>
        </div>
      </dl>
    </>
  );

  return (
    <li
      className={cn(
        "min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm ring-1 ring-foreground/6 transition-[box-shadow] duration-300 ease-out",
        latest && !expanded && "ring-ring/40",
        expanded && "col-span-full shadow-md ring-ring/50",
      )}
    >
      {expanded ? (
        <div className="flex flex-col gap-4 p-4">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={toggleLabel}
            className="-m-1 flex w-full rounded-lg p-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={onToggle}
          >
            {header}
          </button>
          {metrics}
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={toggleLabel}
          className="flex w-full flex-col gap-4 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={onToggle}
        >
          {header}
          {metrics}
          {review.notes ? (
            <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
              {review.notes}
            </p>
          ) : null}
        </button>
      )}

      {!expanded && review.fairValueRef ? (
        <a
          href={review.fairValueRef}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-4 pb-4 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3" aria-hidden="true" />
          <Trans id="allocation.reviewFairValueRefOpen">Open reference</Trans>
        </a>
      ) : null}

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {expanded ? (
            <div className="origin-top border-t px-4 pt-4 pb-4 duration-300 animate-in fade-in slide-in-from-top-2">
              <ReviewEditorForm
                ticker={row.ticker}
                period={review.period}
                review={review}
                saving={saving}
                layout="wide"
                onSave={onSave}
                onRemove={onRemove}
                onCancel={onCollapse}
              />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}
