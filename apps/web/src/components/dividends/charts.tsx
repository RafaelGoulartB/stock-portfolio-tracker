import { Trans } from "@lingui/react/macro";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { AssetLink } from "@/components/asset-link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { formatCompactMoney, formatMoney } from "@/lib/format";
import { eventDay, monthLabel } from "./calendar-utils";
import { chartConfig, type DividendData } from "./types";

export function IncomeChart({ data }: { data: DividendData }) {
  const rows = data.monthly.map((item) => ({
    ...item,
    amount: Number(item.amount),
    label: monthLabel(item.month),
  }));

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.chartTitle">Income by month</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.chartDescription">
            Estimated gross income in the portfolio display currency.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[250px] w-full">
          <BarChart data={rows} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value) =>
                formatCompactMoney(value, data.summary.displayCurrency)
              }
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value) =>
                    formatMoney(String(value), data.summary.displayCurrency)
                  }
                />
              }
            />
            <Bar
              dataKey="amount"
              fill="var(--color-amount)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

export function UpcomingCard({ data }: { data: DividendData }) {
  const upcoming = data.events
    .filter((event) => event.status !== "estimated_paid")
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)))
    .slice(0, 5);

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.upcomingTitle">Upcoming events</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.upcomingDescription">
            Announced events for positions that appear eligible.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            <Trans id="dividends.noUpcoming">
              No upcoming events were published by the selected source.
            </Trans>
          </p>
        ) : (
          <div className="divide-y">
            {upcoming.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-md bg-muted text-xs">
                  <span className="font-semibold">
                    {eventDay(event).slice(8, 10)}
                  </span>
                  <span className="uppercase text-muted-foreground">
                    {monthLabel(eventDay(event).slice(0, 7), "short")}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <AssetLink ticker={event.ticker} className="font-medium">
                    {event.ticker}
                  </AssetLink>
                  <p className="text-xs text-muted-foreground">
                    {event.paymentDate ? (
                      <Trans id="dividends.paymentDate">Payment date</Trans>
                    ) : (
                      <Trans id="dividends.exDate">Ex-date</Trans>
                    )}
                  </p>
                </div>
                <p className="font-medium tabular-nums">
                  {formatMoney(event.grossAmount, event.currency)}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
