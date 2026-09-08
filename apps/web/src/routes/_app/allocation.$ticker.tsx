import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { positiveDecimal, tickerSchema } from "@portifolio-tracker/shared";
import {
  createFileRoute,
  useNavigate,
  useParams,
  useRouter,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { toast } from "sonner";
import { scoreReason } from "@/components/allocation/allocation-table";
import { AssetDetailChart } from "@/components/allocation/asset-detail-chart";
import { AssetMovements } from "@/components/allocation/asset-movements";
import { AssetReviews } from "@/components/allocation/asset-reviews";
import { AssetClassLabel, CurrencyBadge } from "@/components/asset-labels";
import { AssetLogo } from "@/components/asset-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  findReview,
  removeReviewFromList,
  restoreReviewInList,
  reviewFromUpsertInput,
  upsertReviewInList,
} from "@/lib/allocation-review-cache";
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

export function AssetDetailPage() {
  const { i18n } = useLingui();
  const router = useRouter();
  const navigate = useNavigate();
  const { ticker: rawTicker } = useParams({ strict: false }) as {
    ticker: string;
  };
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
  const ledger = trpc.transactions.forTicker.useQuery(
    { ticker },
    { enabled: parsedTicker.success },
  );
  const utils = trpc.useUtils();

  async function refresh() {
    await Promise.all([
      utils.allocation.list.invalidate(),
      utils.allocation.history.invalidate(),
    ]);
  }

  function reportError(error: unknown) {
    toast.error(queryErrorMessage(error));
  }

  const upsertReview = trpc.allocation.upsertReview.useMutation({
    onMutate: async (input) => {
      await utils.allocation.list.cancel(queryInput);
      const snapshot = utils.allocation.list.getData(queryInput);
      const previous = findReview(snapshot, input.ticker, input.period);

      utils.allocation.list.setData(queryInput, (current) =>
        upsertReviewInList(
          current,
          input.ticker,
          reviewFromUpsertInput(input, previous),
        ),
      );

      return { previous };
    },
    onError: (error, input, context) => {
      utils.allocation.list.setData(queryInput, (current) =>
        restoreReviewInList(
          current,
          input.ticker,
          input.period,
          context?.previous,
        ),
      );
      reportError(error);
    },
    onSettled: () => {
      void refresh();
    },
  });
  const removeReview = trpc.allocation.removeReview.useMutation({
    onMutate: async (input) => {
      await utils.allocation.list.cancel(queryInput);
      const snapshot = utils.allocation.list.getData(queryInput);
      const previous = findReview(snapshot, input.ticker, input.period);

      utils.allocation.list.setData(queryInput, (current) =>
        removeReviewFromList(current, input.ticker, input.period),
      );

      return { previous };
    },
    onError: (error, input, context) => {
      utils.allocation.list.setData(queryInput, (current) =>
        restoreReviewInList(
          current,
          input.ticker,
          input.period,
          context?.previous,
        ),
      );
      reportError(error);
    },
    onSettled: () => {
      void refresh();
    },
  });

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

  function goBack() {
    if (router.history.canGoBack()) {
      router.history.back();
      return;
    }

    void navigate({ to: "/positions" });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={goBack}>
          <ArrowLeft aria-hidden="true" />
          <Trans id="allocation.detailBack">Back</Trans>
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
              No details are available for {ticker}.
            </Trans>
          </CardContent>
        </Card>
      ) : null}

      {row && parsedTicker.success ? (
        <>
          <header className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <AssetLogo
                ticker={row.ticker}
                assetClass={row.assetClass}
                currency={row.currency}
                className="size-10"
              />
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

          {reviews.length === 0 ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">
                <Trans id="allocation.detailReviews">Quarterly reviews</Trans>
              </h2>
              <p className="text-sm text-muted-foreground">
                <Trans id="allocation.detailReviewsEmpty">
                  No grades, notes or fair values have been added yet.
                </Trans>
              </p>
            </section>
          ) : (
            <AssetReviews
              reviews={reviews}
              row={row}
              series={history.data?.series}
              locale={i18n.locale}
              onSave={(input) => upsertReview.mutate(input)}
              onRemove={(input) => removeReview.mutate(input)}
            />
          )}

          {ledger.isPending ? <Skeleton className="h-72 w-full" /> : null}
          {ledger.error ? (
            <p className="text-sm text-destructive">
              {queryErrorMessage(ledger.error)}
            </p>
          ) : null}
          {ledger.data ? (
            <AssetMovements row={row} ledger={ledger.data} />
          ) : null}
        </>
      ) : null}
    </div>
  );
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
