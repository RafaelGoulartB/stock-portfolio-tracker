import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { type ReactNode, useState } from "react";
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
          <SectionNav assessed={report.data.assessed} />
          <Warnings warnings={report.data.warnings} />
          {report.data.assessed ? (
            <>
              <section id="ir-summary" className="scroll-mt-32">
                <SummaryStats report={report.data} />
              </section>
              <section id="ir-monthly" className="scroll-mt-32">
                <MonthlyTable report={report.data} />
              </section>
              <section id="ir-exempt" className="scroll-mt-32">
                <ExemptIncomeCard report={report.data} />
              </section>
              <section id="ir-foreign" className="scroll-mt-32">
                <ForeignSection report={report.data} />
              </section>
              <section id="ir-sales" className="scroll-mt-32">
                <SalesTable report={report.data} />
              </section>
            </>
          ) : null}
          <section id="ir-holdings" className="scroll-mt-32">
            <HoldingsTable report={report.data} />
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * Jump links to the report's sections, pinned under the app header. The
 * report is long and the IRPF program asks for it sheet by sheet.
 */
function SectionNav({ assessed }: { assessed: boolean }) {
  const sections: { id: string; label: ReactNode }[] = [
    ...(assessed
      ? [
          {
            id: "ir-summary",
            label: <Trans id="incomeTax.nav.summary">Summary</Trans>,
          },
          {
            id: "ir-monthly",
            label: <Trans id="incomeTax.nav.monthly">Renda Variável</Trans>,
          },
          {
            id: "ir-exempt",
            label: <Trans id="incomeTax.nav.exempt">Exempt income</Trans>,
          },
          {
            id: "ir-foreign",
            label: <Trans id="incomeTax.nav.foreign">Foreign assets</Trans>,
          },
          {
            id: "ir-sales",
            label: <Trans id="incomeTax.nav.sales">Sales</Trans>,
          },
        ]
      : []),
    {
      id: "ir-holdings",
      label: <Trans id="incomeTax.nav.holdings">Bens e Direitos</Trans>,
    },
  ];

  if (sections.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label={t({ id: "incomeTax.nav.label", message: "Report sections" })}
      className="sticky top-0 z-30 -mx-1 overflow-x-auto bg-background/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:top-14 print:hidden"
    >
      <ul className="flex w-max gap-1.5">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className="inline-flex h-8 items-center rounded-full border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
