import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useState } from "react";
import { OpeningBalances } from "@/components/income-tax/opening-balances";
import {
  ExemptIncomeCard,
  ForeignSection,
  HoldingsTable,
  MonthlyTable,
  SalesTable,
  SummaryStats,
  Warnings,
} from "@/components/income-tax/report-sections";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/api";
import { queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/income-tax")({
  component: IncomeTaxPage,
});

const THIS_YEAR = new Date().getFullYear();

function IncomeTaxPage() {
  const utils = trpc.useUtils();
  // The latest closed year is the one being declared most of the time.
  const [year, setYear] = useState(THIS_YEAR - 1);
  const settings = trpc.incomeTax.settings.useQuery();
  const report = trpc.incomeTax.report.useQuery({ year });

  const yearOptions = [
    ...new Set([
      ...(report.data?.years ?? []),
      ...(settings.data ? [settings.data.startYear] : []),
      THIS_YEAR - 1,
      THIS_YEAR,
      year,
    ]),
  ].sort((a, b) => b - a);

  async function refresh() {
    await utils.incomeTax.invalidate();
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="incomeTax.title">Income tax</Trans>{" "}
            <span className="hidden print:inline">{year}</span>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Trans id="incomeTax.subtitle">
              Buys and sells assessed from your broker notes and trades, to help
              fill in the IRPF. Dividends and other income are not included.
              Check it against your documents before filing.
            </Trans>
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Select
            value={String(year)}
            onValueChange={(value) => setYear(Number(value))}
          >
            <SelectTrigger
              className="w-28"
              aria-label={t({ id: "incomeTax.year", message: "Year" })}
              id="income-tax-year"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer aria-hidden="true" />
            <Trans id="incomeTax.print">Print report</Trans>
          </Button>
        </div>
      </header>

      {settings.data ? (
        <OpeningBalances settings={settings.data} onSaved={refresh} />
      ) : settings.isError ? null : (
        <Skeleton className="h-36 w-full" />
      )}

      {report.isError ? (
        <Card>
          <CardContent className="text-sm text-destructive">
            {queryErrorMessage(report.error)}
          </CardContent>
        </Card>
      ) : !report.data ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      ) : (
        <div
          className={
            report.isFetching
              ? "space-y-5 opacity-70 transition-opacity"
              : "space-y-5"
          }
        >
          <Warnings warnings={report.data.warnings} />
          {report.data.assessed ? (
            <>
              <SummaryStats report={report.data} />
              <MonthlyTable report={report.data} />
              <ExemptIncomeCard report={report.data} />
              <ForeignSection report={report.data} />
              <SalesTable report={report.data} />
            </>
          ) : null}
          <HoldingsTable report={report.data} />
        </div>
      )}
    </div>
  );
}
