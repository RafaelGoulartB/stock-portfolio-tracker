import { Trans } from "@lingui/react/macro";
import {
  CalendarDays,
  CircleDollarSign,
  Clock3,
  WalletCards,
} from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { formatMoney, formatTradeDate } from "@/lib/format";
import type { DividendData } from "./types";

export function Summary({ data }: { data: DividendData }) {
  const { summary } = data;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        <Metric
          icon={WalletCards}
          label={<Trans id="dividends.total">Estimated income</Trans>}
          value={formatMoney(summary.convertedTotal, summary.displayCurrency)}
          hint={<Trans id="dividends.selectedPeriod">Selected period</Trans>}
        />
        <Metric
          icon={Clock3}
          label={<Trans id="dividends.upcoming">Upcoming</Trans>}
          value={formatMoney(
            summary.convertedUpcoming,
            summary.displayCurrency,
          )}
          hint={
            <Trans id="dividends.eventCount">
              {summary.upcomingCount} events
            </Trans>
          }
        />
        <Metric
          icon={CalendarDays}
          label={<Trans id="dividends.nextDate">Next relevant date</Trans>}
          value={
            summary.nextPaymentDate
              ? formatTradeDate(summary.nextPaymentDate)
              : "—"
          }
          hint={
            <Trans id="dividends.paymentOrExDate">Payment or ex-date</Trans>
          }
        />
        <Metric
          icon={CircleDollarSign}
          label={<Trans id="dividends.events">Income events</Trans>}
          value={String(summary.eventCount)}
          hint={summary.nativeTotals
            .map((item) => formatMoney(item.amount, item.currency))
            .join(" · ")}
        />
      </div>
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CalendarDays;
  label: ReactNode;
  value: string;
  hint: ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <p className="mt-1.5 text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
