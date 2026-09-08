import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { CircleDollarSign, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IncomeCalendar } from "./calendar";
import { IncomeChart, UpcomingCard } from "./charts";
import { HistoryTable } from "./history-table";
import { Summary } from "./summary";
import type { DividendData } from "./types";

export function DividendsContent({ data }: { data: DividendData }) {
  if (data.events.length === 0) {
    return (
      <>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <CircleDollarSign className="size-9 text-muted-foreground" />
            <div>
              <p className="font-medium">
                <Trans id="dividends.emptyTitle">No income events found</Trans>
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                <Trans id="dividends.emptyDescription">
                  Register stock or ETF trades, or try a longer history window.
                </Trans>
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/transactions">
                <Plus className="size-4" />
                <Trans id="dividends.addTrade">Register a trade</Trans>
              </Link>
            </Button>
          </CardContent>
        </Card>
        <ProviderNotice data={data} />
      </>
    );
  }

  return (
    <>
      <Summary data={data} />
      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <IncomeChart data={data} />
        <UpcomingCard data={data} />
      </div>
      <IncomeCalendar events={data.events} />
      <HistoryTable
        key={`${data.provider.requested}|${data.range.start}|${data.range.end}`}
        data={data}
      />
      <ProviderNotice data={data} />
    </>
  );
}

export function ProviderNotice({ data }: { data: DividendData }) {
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>
        <Trans id="dividends.disclaimer">
          Provider events do not confirm a broker credit. Amounts exclude taxes
          and broker adjustments.
        </Trans>
      </p>
      {data.provider.requested === "auto" &&
      !data.provider.alphaVantageConfigured ? (
        <p>
          <Trans id="dividends.alphaHint">
            Automatic mode is currently using Yahoo only. Set
            ALPHA_VANTAGE_API_KEY on the API to enrich US events with payment
            dates and future declarations.
          </Trans>
        </p>
      ) : null}
      {data.provider.requested === "alpha_vantage" &&
      !data.provider.alphaVantageConfigured ? (
        <p>
          <Trans id="dividends.alphaNotConfigured">
            Alpha Vantage is not configured. Set ALPHA_VANTAGE_API_KEY on the
            API or select Automatic to use the Yahoo fallback.
          </Trans>
        </p>
      ) : null}
      {data.provider.missing.length > 0 ? (
        <p>
          <Trans id="dividends.unavailable">
            Unavailable tickers: {data.provider.missing.join(", ")}.
          </Trans>
        </p>
      ) : null}
      {data.summary.unconvertedEvents > 0 ? (
        <p>
          <Trans id="dividends.unconverted">
            {data.summary.unconvertedEvents} events could not be converted.
          </Trans>
        </p>
      ) : null}
    </div>
  );
}

export function DividendsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  );
}
