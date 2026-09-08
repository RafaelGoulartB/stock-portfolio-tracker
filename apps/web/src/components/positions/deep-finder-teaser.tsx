import { Trans } from "@lingui/react/macro";
import {
  type Currency,
  type PortfolioSummary,
  positiveDecimal,
  type ValuedPosition,
} from "@portifolio-tracker/shared";
import { Link } from "@tanstack/react-router";
import { ScanSearch } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { AssetLink } from "@/components/asset-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/api";
import { formatSignedPercent, pnlClassName } from "@/lib/format";
import { useFxRequest } from "@/lib/fx";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";
import { signedOrZero } from "./shared";

type MoverRow = {
  ticker: string;
  change: string | null;
  changePercent: string | null;
};

function pickTopMovers(rows: MoverRow[], limit = 3) {
  const comparable = rows.filter((row) => row.changePercent != null);
  const gainers = comparable
    .filter((row) => Number(row.changePercent) > 0)
    .sort((a, b) => Number(b.changePercent) - Number(a.changePercent))
    .slice(0, limit);
  const losers = comparable
    .filter((row) => Number(row.changePercent) < 0)
    .sort((a, b) => Number(a.changePercent) - Number(b.changePercent))
    .slice(0, limit);

  return { gainers, losers };
}

export function DeepFinderTeaser({
  className,
  positions,
  summary,
}: {
  className?: string;
  positions: ValuedPosition[];
  summary: PortfolioSummary;
}) {
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const fxRequest = useFxRequest();
  const sanitizedManualPrices = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(manualPrices).filter(
          ([, price]) => positiveDecimal.safeParse(price).success,
        ),
      ),
    [manualPrices],
  );
  const month = trpc.positions.finder.useQuery({
    displayCurrency,
    ...fxRequest,
    quoteSource,
    window: "1m",
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });

  const fallbackRows = useMemo<MoverRow[]>(
    () =>
      positions.map((position) => ({
        ticker: position.ticker,
        change: position.convertedUnrealizedPnl,
        changePercent: position.unrealizedPnlPercent,
      })),
    [positions],
  );

  const showSkeleton = month.isPending && !month.data;
  const movers = pickTopMovers(
    month.data?.positions ?? (month.isError ? fallbackRows : []),
  );
  const totalChange =
    month.data?.summary.totalChange ?? summary.totalUnrealizedPnl;
  const currency =
    month.data?.summary.displayCurrency ?? summary.displayCurrency;
  const rising =
    month.data?.summary.advancing ??
    fallbackRows.filter((row) => Number(row.changePercent) > 0).length;
  const falling =
    month.data?.summary.declining ??
    fallbackRows.filter((row) => Number(row.changePercent) < 0).length;

  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>
          <Trans id="positions.teaserTitle">Summary</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="positions.teaserHint">
            Biggest percent moves over the last month. Open Deep Finder for
            every ticker and lookback window.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-5 lg:grid lg:grid-cols-3 lg:items-start lg:gap-10">
        {showSkeleton ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-44" />
            <Skeleton className="h-4 w-36" />
          </div>
        ) : (
          <div>
            <p
              className={`text-2xl font-semibold tabular-nums ${pnlClassName(totalChange)}`}
            >
              {signedOrZero(totalChange, currency)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="text-foreground tabular-nums">{rising}</span>{" "}
              <Trans id="positions.teaserRising">rising</Trans>
              <span aria-hidden="true"> · </span>
              <span className="text-foreground tabular-nums">{falling}</span>{" "}
              <Trans id="positions.teaserFalling">falling</Trans>
            </p>
          </div>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-5 lg:col-span-2 lg:flex-row lg:gap-10">
          <MoverList
            className="lg:flex-1"
            title={<Trans id="positions.teaserGainers">Top gainers</Trans>}
            empty={
              <Trans id="positions.teaserEmptyUp">
                No rising holdings this month.
              </Trans>
            }
            rows={movers.gainers}
            currency={currency}
            loading={showSkeleton}
          />
          <MoverList
            title={<Trans id="positions.teaserLosers">Top losers</Trans>}
            empty={
              <Trans id="positions.teaserEmptyDown">
                No falling holdings this month.
              </Trans>
            }
            className="lg:flex-1"
            rows={movers.losers}
            currency={currency}
            loading={showSkeleton}
          />
        </div>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button asChild className="w-full sm:w-auto">
          <Link to="/deep-finder">
            <ScanSearch className="size-4" aria-hidden="true" />
            <Trans id="positions.openDeepFinder">Open Deep Finder</Trans>
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function MoverList({
  className,
  title,
  empty,
  rows,
  currency,
  loading,
}: {
  className?: string;
  title: ReactNode;
  empty: ReactNode;
  rows: MoverRow[];
  currency: Currency;
  loading: boolean;
}) {
  return (
    <section className={className}>
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {loading ? (
        <ul className="mt-2 space-y-2">
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
          <li>
            <Skeleton className="h-5 w-full" />
          </li>
        </ul>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {rows.map((row) => (
            <li key={row.ticker} className="flex items-baseline gap-3 text-sm">
              <AssetLink ticker={row.ticker} className="font-medium">
                {row.ticker}
              </AssetLink>
              <span
                className={cn(
                  "ml-auto tabular-nums",
                  row.changePercent ? pnlClassName(row.changePercent) : "",
                )}
              >
                {row.changePercent
                  ? formatSignedPercent(row.changePercent)
                  : "—"}
              </span>
              <span
                className={cn(
                  "w-[7.25rem] text-right tabular-nums",
                  row.change ? pnlClassName(row.change) : "",
                )}
              >
                {row.change ? signedOrZero(row.change, currency) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
