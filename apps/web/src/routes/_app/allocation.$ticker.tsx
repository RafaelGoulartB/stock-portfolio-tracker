import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AllocationRow, AssetReview } from "@portifolio-tracker/shared";
import {
  positiveDecimal,
  quarterEndDate,
  tickerSchema,
} from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { scoreReason } from "@/components/allocation/allocation-table";
import { AssetDetailChart } from "@/components/allocation/asset-detail-chart";
import { gradeToneClass } from "@/components/allocation/quarter-review-cell";
import { AssetClassLabel, CurrencyBadge } from "@/components/asset-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/api";
import {
  formatMoney,
  formatQuantity,
  formatSignedWeightPrecise,
  formatTradeDate,
  formatWeightPrecise,
  pnlClassName,
} from "@/lib/format";
import { useFxQuote } from "@/lib/fx";
import { formatDecimalInput } from "@/lib/numeric-input";
import { formatQuarterTitle, toQuarter } from "@/lib/quarters";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/allocation/$ticker")({
  component: AssetDetailPage,
});

function AssetDetailPage() {
  const { i18n } = useLingui();
  const { ticker: rawTicker } = Route.useParams();
  const parsedTicker = tickerSchema.safeParse(rawTicker);
  const ticker = parsedTicker.success
    ? parsedTicker.data
    : rawTicker.toUpperCase();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fx = useFxQuote();

  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const queryInput = {
    displayCurrency,
    usdBrlRate: fx.effectiveRate,
    quoteSource,
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  };

  const allocation = trpc.allocation.list.useQuery(queryInput);
  const history = trpc.allocation.history.useQuery(
    {
      ...queryInput,
      ticker,
    },
    { enabled: parsedTicker.success },
  );

  const waitingForRate =
    !!allocation.error && isFxRateRequired(allocation.error) && fx.isPending;
  const row = allocation.data?.rows.find((entry) => entry.ticker === ticker);
  const reviews = useMemo(
    () =>
      [...(row?.reviews ?? [])].sort((a, b) =>
        b.period.localeCompare(a.period),
      ),
    [row],
  );

  return (
    <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 space-y-5 px-3 sm:px-4 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link to="/allocation">
            <ArrowLeft aria-hidden="true" />
            <Trans id="allocation.detailBack">Allocation</Trans>
          </Link>
        </Button>
      </div>

      {allocation.isPending || waitingForRate ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      ) : null}

      {allocation.error && !waitingForRate ? (
        <p className="text-sm text-destructive">
          {queryErrorMessage(allocation.error)}
        </p>
      ) : null}

      {allocation.data && (!row || !parsedTicker.success) ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Trans id="allocation.detailMissing">
              {ticker} is not on the allocation table.
            </Trans>
          </CardContent>
        </Card>
      ) : null}

      {row && parsedTicker.success ? (
        <>
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                {row.ticker}
              </h1>
              {row.hasPosition ? null : (
                <Badge variant="outline">
                  <Trans id="allocation.watchBadge">Watch</Trans>
                </Badge>
              )}
              <Badge variant="secondary">
                <AssetClassLabel assetClass={row.assetClass} />
              </Badge>
              <CurrencyBadge currency={row.currency} />
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {scoreReason(row, i18n)}
            </p>
          </header>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label={i18n._(t({ id: "allocation.colValue", message: "Value" }))}
              value={
                row.marketValue === null
                  ? "—"
                  : formatMoney(row.marketValue, row.displayCurrency)
              }
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.detailPrice", message: "Market" }),
              )}
              value={
                row.marketPrice === null
                  ? "—"
                  : formatMoney(row.marketPrice, row.currency)
              }
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.colFairValue", message: "Fair value" }),
              )}
              value={
                row.fairValue === null
                  ? "—"
                  : formatMoney(row.fairValue, row.currency)
              }
              hint={
                row.fairValuePeriod
                  ? formatQuarterTitle(toQuarter(row.fairValuePeriod))
                  : undefined
              }
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.colDiscount", message: "Discount" }),
              )}
              value={
                row.discount === null
                  ? "—"
                  : formatSignedWeightPrecise(row.discount)
              }
              className={row.discount ? pnlClassName(row.discount) : undefined}
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.colTarget", message: "Target" }),
              )}
              value={
                row.targetWeight === null
                  ? "—"
                  : formatWeightPrecise(row.targetWeight)
              }
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.colCurrent", message: "Current" }),
              )}
              value={formatWeightPrecise(row.currentWeight)}
            />
            <Stat
              label={i18n._(t({ id: "allocation.colGap", message: "Gap" }))}
              value={
                row.gapWeight === null
                  ? "—"
                  : formatSignedWeightPrecise(row.gapWeight)
              }
              className={
                row.gapWeight ? pnlClassName(row.gapWeight) : undefined
              }
            />
            <Stat
              label={i18n._(t({ id: "allocation.colScore", message: "Score" }))}
              value={
                row.score.blocked
                  ? "—"
                  : formatSignedWeightPrecise(row.score.value)
              }
            />
            <Stat
              label={i18n._(t({ id: "allocation.colGrade", message: "Grade" }))}
              value={
                row.averageGrade === null
                  ? "—"
                  : formatDecimalInput(row.averageGrade, i18n.locale)
              }
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.colQuantity", message: "Shares" }),
              )}
              value={row.hasPosition ? formatQuantity(row.quantity) : "—"}
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.colLastBuy", message: "Last buy" }),
              )}
              value={
                row.lastContributionAt === null
                  ? "—"
                  : formatTradeDate(row.lastContributionAt)
              }
              hint={
                row.score.cooldownUntil
                  ? i18n._(
                      t({
                        id: "allocation.cooldownIcon",
                        message: `In cooldown until ${row.score.cooldownUntil}`,
                      }),
                    )
                  : undefined
              }
            />
            <Stat
              label={i18n._(
                t({ id: "allocation.detailAvgPrice", message: "Average cost" }),
              )}
              value={
                row.hasPosition
                  ? formatMoney(row.averagePrice, row.currency)
                  : "—"
              }
            />
          </dl>

          {history.isPending ? <Skeleton className="h-72 w-full" /> : null}
          {history.error ? (
            <p className="text-sm text-destructive">
              {queryErrorMessage(history.error)}
            </p>
          ) : null}
          {history.data ? (
            <AssetDetailChart
              series={history.data.series}
              currency={history.data.currency}
            />
          ) : null}

          <section className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              <Trans id="allocation.detailReviews">Quarterly reviews</Trans>
            </h2>
            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                <Trans id="allocation.detailReviewsEmpty">
                  No grades, notes or fair values yet. Open a quarter on the
                  allocation table to add the first review.
                </Trans>
              </p>
            ) : (
              <ol className="space-y-3">
                {reviews.map((review) => (
                  <ReviewCard
                    key={review.period}
                    review={review}
                    row={row}
                    close={closeOn(history.data?.series, review.period)}
                  />
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

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

function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}): ReactNode {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium tabular-nums", className)}>
        {value}
      </dd>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function ReviewCard({
  review,
  row,
  close,
}: {
  review: AssetReview;
  row: AllocationRow;
  close: string | null;
}): ReactNode {
  const { i18n } = useLingui();
  const quarter = toQuarter(review.period);
  const discount =
    review.fairValue === null || close === null
      ? null
      : String(
          (Number(review.fairValue) - Number(close)) / Number(review.fairValue),
        );

  return (
    <li className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-semibold">{formatQuarterTitle(quarter)}</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {review.grade === null ? (
              <span className="text-muted-foreground">
                <Trans id="allocation.detailNoGrade">No grade</Trans>
              </span>
            ) : (
              <span
                className={cn(
                  "inline-flex min-w-8 justify-center rounded-sm px-1.5 py-0.5 text-xs font-medium tabular-nums",
                  gradeToneClass(review.grade),
                )}
              >
                {formatDecimalInput(review.grade, i18n.locale)}
              </span>
            )}
            {review.fairValue === null ? (
              <span className="text-muted-foreground">
                <Trans id="allocation.detailNoFairValue">No fair value</Trans>
              </span>
            ) : (
              <span className="tabular-nums">
                {formatMoney(review.fairValue, row.currency)}
              </span>
            )}
            {discount === null ? null : (
              <span className={cn("tabular-nums", pnlClassName(discount))}>
                {formatSignedWeightPrecise(discount)}
              </span>
            )}
          </div>
        </div>
        {review.fairValueRef ? (
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
      {review.notes ? (
        <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
          {review.notes}
        </p>
      ) : null}
    </li>
  );
}
