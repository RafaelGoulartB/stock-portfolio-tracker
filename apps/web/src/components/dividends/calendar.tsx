import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { AssetLink } from "@/components/asset-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { i18n } from "@/i18n";
import { formatMoney } from "@/lib/format";
import {
  calendarCells,
  currentMonth,
  eventDay,
  monthLabel,
  moveMonth,
  weekdays,
} from "./calendar-utils";
import { DividendDetailsDialog } from "./details-dialog";
import type { DividendEvent } from "./types";

export function IncomeCalendar({ events }: { events: DividendEvent[] }) {
  const [month, setMonth] = useState(currentMonth);
  const [selectedEvent, setSelectedEvent] = useState<DividendEvent | null>(
    null,
  );
  const byDay = useMemo(() => {
    const result = new Map<string, DividendEvent[]>();
    for (const event of events) {
      const day = eventDay(event);
      result.set(day, [...(result.get(day) ?? []), event]);
    }
    return result;
  }, [events]);
  const cells = calendarCells(month);
  const monthEvents = events
    .filter((event) => eventDay(event).startsWith(month))
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)));

  return (
    <Card>
      <CardHeader className="flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>
            <Trans id="dividends.calendarTitle">Income calendar</Trans>
          </CardTitle>
          <CardDescription>
            <Trans id="dividends.calendarDescription">
              Payment dates when known; otherwise, the ex-date.
            </Trans>
          </CardDescription>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setMonth(moveMonth(month, -1))}
            aria-label={i18n._(
              msg({
                id: "dividends.previousMonth",
                message: "Previous month",
              }),
            )}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="w-32 text-center text-sm font-medium">
            {monthLabel(month, "long")}
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setMonth(moveMonth(month, 1))}
            aria-label={i18n._(
              msg({ id: "dividends.nextMonth", message: "Next month" }),
            )}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          <div className="grid grid-cols-7 border-b text-center text-xs text-muted-foreground">
            {weekdays().map((day) => (
              <div key={day} className="py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const dayEvents = byDay.get(cell.day) ?? [];
              return (
                <div
                  key={cell.day}
                  className={`min-h-20 border-b border-r p-2 text-sm first:border-l ${cell.inMonth ? "" : "bg-muted/25 text-muted-foreground"}`}
                >
                  <span
                    className={
                      cell.day === new Date().toISOString().slice(0, 10)
                        ? "flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground"
                        : ""
                    }
                  >
                    {Number(cell.day.slice(8, 10))}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {dayEvents.slice(0, 3).map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        title={`${event.ticker} · ${formatMoney(event.grossAmount, event.currency)}`}
                        aria-label={`${event.ticker} · ${formatMoney(event.grossAmount, event.currency)}`}
                        className="flex size-6 items-center justify-center rounded-full outline-none hover:bg-gain/15 focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setSelectedEvent(event)}
                      >
                        <span className="size-2.5 rounded-full bg-gain" />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-lg border bg-muted/20 p-4">
          <p className="font-medium">{monthLabel(month, "long")}</p>
          {monthEvents.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              <Trans id="dividends.calendarEmpty">No events this month.</Trans>
            </p>
          ) : (
            <div className="mt-2 divide-y">
              {monthEvents.map((event) => (
                <div key={event.id} className="flex items-center gap-3 py-3">
                  <span className="w-7 text-sm font-semibold tabular-nums">
                    {eventDay(event).slice(8, 10)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <AssetLink
                      ticker={event.ticker}
                      className="text-sm font-medium"
                    >
                      {event.ticker}
                    </AssetLink>
                    <p className="text-xs text-muted-foreground">
                      {event.paymentDate ? (
                        <Trans id="dividends.payment">Payment</Trans>
                      ) : (
                        <Trans id="dividends.exDate">Ex-date</Trans>
                      )}
                    </p>
                  </div>
                  <span className="text-sm tabular-nums">
                    {formatMoney(event.grossAmount, event.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
      <DividendDetailsDialog
        event={selectedEvent}
        onOpenChange={(open) => {
          if (!open) setSelectedEvent(null);
        }}
      />
    </Card>
  );
}
