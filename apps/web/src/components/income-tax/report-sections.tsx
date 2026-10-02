import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import type {
  ForeignCashBalance,
  IncomeTaxHolding,
  IncomeTaxMonth,
  IncomeTaxReport,
  IncomeTaxWarning,
  TaxKind,
} from "@portifolio-tracker/shared";
import { AlertTriangle, Info, Pencil, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  AssetProfileDialog,
  DarfPaymentDialog,
  ForeignCashDialog,
} from "@/components/income-tax/record-dialogs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/api";
import {
  formatMoney,
  formatPreciseMoney,
  formatQuantity,
  formatTradeDate,
  pnlClassName,
} from "@/lib/format";
import { queryErrorMessage } from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";

function brl(value: string | null) {
  return value === null ? "—" : formatMoney(value, "BRL");
}

function Amount({ value, signed }: { value: string | null; signed?: boolean }) {
  if (value === null) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className={cn("tabular-nums", signed && pnlClassName(value))}>
      {formatMoney(value, "BRL")}
    </span>
  );
}

function useMonthLabel() {
  const { i18n } = useLingui();
  const formatter = new Intl.DateTimeFormat(i18n.locale, {
    month: "short",
    timeZone: "UTC",
  });

  return (key: string) => {
    const [year, month] = key.split("-").map(Number);
    return formatter.format(
      new Date(Date.UTC(year ?? 2000, (month ?? 1) - 1, 1)),
    );
  };
}

function Stat({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {hint ? (
        <div className="text-xs text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  );
}

export function SummaryStats({ report }: { report: IncomeTaxReport }) {
  const { totals, foreign } = report;
  const darfPaid = brl(totals.darfPaid);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat
        label={<Trans id="incomeTax.summary.darf">DARFs of the year</Trans>}
        value={brl(totals.darf)}
        hint={
          <Trans id="incomeTax.summary.darfHint">
            Code 6015, due by the last business day of the following month.
            Recorded as paid: {darfPaid}.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="incomeTax.summary.exempt">Exempt stock gains</Trans>}
        value={brl(totals.exemptGain)}
        hint={
          <Trans id="incomeTax.summary.exemptHint">
            Exempt income, type 20: months with stock sales up to R$ 20,000.
          </Trans>
        }
      />
      <Stat
        label={<Trans id="incomeTax.summary.withheldLeft">IRRF to claim</Trans>}
        value={brl(totals.withheldLeft)}
        hint={
          <Trans id="incomeTax.summary.withheldLeftHint">
            Withheld tax not used by December: Imposto Pago/Retido, item 03.
          </Trans>
        }
      />
      <Stat
        label={
          <Trans id="incomeTax.summary.foreignTax">
            Foreign tax (estimate)
          </Trans>
        }
        value={brl(foreign.estimatedTax)}
        hint={
          <Trans id="incomeTax.summary.foreignTaxHint">
            15% of the year's foreign sales result, before foreign income.
          </Trans>
        }
      />
      <Stat
        label={
          <Trans id="incomeTax.summary.ordinaryLoss">
            Ordinary loss carried
          </Trans>
        }
        value={brl(totals.ordinaryLoss)}
      />
      <Stat
        label={
          <Trans id="incomeTax.summary.dayTradeLoss">
            Day-trade loss carried
          </Trans>
        }
        value={brl(totals.dayTradeLoss)}
      />
      <Stat
        label={<Trans id="incomeTax.summary.fiiLoss">FII loss carried</Trans>}
        value={brl(totals.fiiLoss)}
      />
      <Stat
        label={
          <Trans id="incomeTax.summary.foreignLoss">Foreign loss carried</Trans>
        }
        value={brl(foreign.lossAfter)}
      />
    </div>
  );
}

function warningContent(warning: IncomeTaxWarning): {
  title: ReactNode;
  body: ReactNode;
  severe: boolean;
} {
  switch (warning.code) {
    case "not_configured":
      return {
        severe: true,
        title: (
          <Trans id="incomeTax.warning.notConfigured.title">
            Opening balances not set
          </Trans>
        ),
        body: (
          <Trans id="incomeTax.warning.notConfigured.body">
            Losses carried from before your first trade are unknown, so the tax
            may be overstated. Set them under Opening balances.
          </Trans>
        ),
      };
    case "before_start": {
      const startYear = warning.startYear;
      return {
        severe: false,
        title: (
          <Trans id="incomeTax.warning.beforeStart.title">
            Year before the assessment
          </Trans>
        ),
        body: (
          <Trans id="incomeTax.warning.beforeStart.body">
            Assessment starts in {startYear}. This year shows only the holdings
            on 31 December.
          </Trans>
        ),
      };
    }
    case "missing_rates": {
      const tickers = warning.tickers.join(", ");
      return {
        severe: true,
        title: (
          <Trans id="incomeTax.warning.missingRates.title">
            USD trades without a trade-date rate
          </Trans>
        ),
        body: (
          <Trans id="incomeTax.warning.missingRates.body">
            {tickers}: fill the PTAX from Transactions. Foreign results and
            costs stay blank instead of using another rate.
          </Trans>
        ),
      };
    }
    case "uncovered_sales": {
      const tickers = warning.tickers.join(", ");
      return {
        severe: true,
        title: (
          <Trans id="incomeTax.warning.uncovered.title">
            Sales not assessed here
          </Trans>
        ),
        body: (
          <Trans id="incomeTax.warning.uncovered.body">
            {tickers}: crypto, fixed income and other classes follow different
            rules and are left out of this report.
          </Trans>
        ),
      };
    }
    case "units_assumed": {
      const tickers = warning.tickers.join(", ");
      return {
        severe: false,
        title: (
          <Trans id="incomeTax.warning.units.title">
            Tickers ending in 11 treated as units
          </Trans>
        ),
        body: (
          <Trans id="incomeTax.warning.units.body">
            {tickers}: taxed at 15% and never exempt. If one is a real estate
            fund, change its class to REIT so it is taxed as an FII (20%).
          </Trans>
        ),
      };
    }
    case "day_trades": {
      const count = warning.count;
      return {
        severe: false,
        title: (
          <Trans id="incomeTax.warning.dayTrades.title">Day trades found</Trans>
        ),
        body: (
          <Trans id="incomeTax.warning.dayTrades.body">
            {count} same-day buy and sell pairings were assessed as day trades
            (20%) without changing the average cost of the position held before.
          </Trans>
        ),
      };
    }
  }
}

export function Warnings({ warnings }: { warnings: IncomeTaxWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-3">
      {warnings.map((warning) => {
        const { title, body, severe } = warningContent(warning);
        const Icon = severe ? AlertTriangle : Info;

        return (
          <Alert
            key={warning.code}
            className={cn(severe && "border-caution/50 bg-caution/10")}
          >
            <Icon
              aria-hidden="true"
              className={cn(severe ? "text-caution" : "text-muted-foreground")}
            />
            <AlertTitle>{title}</AlertTitle>
            <AlertDescription>{body}</AlertDescription>
          </Alert>
        );
      })}
    </div>
  );
}

/** Recorded payment of a month's DARF, with ways to record, edit or undo it. */
function DarfPaymentCell({
  month,
  onEdit,
}: {
  month: IncomeTaxMonth;
  onEdit: () => void;
}) {
  const utils = trpc.useUtils();
  const remove = trpc.incomeTax.removeDarfPayment.useMutation({
    onSuccess: async () => {
      toast.success(
        t({ id: "incomeTax.darf.removed", message: "DARF payment removed" }),
      );
      await utils.incomeTax.report.invalidate();
    },
    onError: (error) => toast.error(queryErrorMessage(error)),
  });
  const due = month.darf !== "0.00";

  if (month.darfPaid !== null) {
    const short =
      month.darfPaidOn !== null && Number(month.darfPaid) < Number(month.darf);
    const paidOn = month.darfPaidOn ? formatTradeDate(month.darfPaidOn) : "";

    return (
      <div className="flex items-start justify-end gap-1">
        <div className="text-right">
          <div className={cn("tabular-nums", short && "text-loss")}>
            {formatMoney(month.darfPaid, "BRL")}
          </div>
          <div className="text-[11px] text-muted-foreground">
            <Trans id="incomeTax.darf.paidOnShort">on {paidOn}</Trans>
          </div>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="print:hidden"
          aria-label={t({
            id: "incomeTax.darf.editLabel",
            message: "Edit the DARF payment",
          })}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="print:hidden"
          aria-label={t({
            id: "incomeTax.darf.removeLabel",
            message: "Remove the DARF payment",
          })}
          disabled={remove.isPending}
          onClick={() => remove.mutate({ month: month.month })}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (!due) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-[11px] font-medium text-loss">
        <Trans id="incomeTax.darf.unpaid">Not recorded</Trans>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs print:hidden"
        onClick={onEdit}
      >
        <Trans id="incomeTax.darf.record">Record payment</Trans>
      </Button>
    </div>
  );
}

export function MonthlyTable({ report }: { report: IncomeTaxReport }) {
  const monthLabel = useMonthLabel();
  const [paying, setPaying] = useState<IncomeTaxMonth | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="incomeTax.monthly.title">B3 monthly assessment</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="incomeTax.monthly.description">
            Renda Variável sheet: ordinary operations 15%, day trade 20%, FIIs
            20%. Each loss pool only offsets its own kind; withheld tax offsets
            the month and later months of the same year.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table className="min-w-[1200px] text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans id="incomeTax.monthly.month">Month</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.stockSales">Stock sales</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.ordinary">Ordinary</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.dayTrade">Day trade</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.fii">FII</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.losses">
                  Losses left (ord. / DT / FII)
                </Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.taxDue">Tax due</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.withheld">IRRF (sales / DT)</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.withheldUsed">IRRF used</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.darf">DARF</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.monthly.darfPaid">Paid</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report.months.map((month) => (
              <TableRow key={month.month}>
                <TableCell className="font-medium capitalize">
                  {monthLabel(month.month)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="tabular-nums">{brl(month.stockSales)}</div>
                  {month.exempt ? (
                    <Badge variant="secondary" className="mt-1">
                      <Trans id="incomeTax.monthly.exempt">
                        Exempt {formatMoney(month.exemptGain, "BRL")}
                      </Trans>
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={month.ordinaryResult} signed />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={month.dayTradeResult} signed />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={month.fiiResult} signed />
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {brl(month.ordinaryLoss)} / {brl(month.dayTradeLoss)} /{" "}
                  {brl(month.fiiLoss)}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={month.taxDue} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {brl(month.withheld)} / {brl(month.withheldDayTrade)}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={month.withheldUsed} />
                </TableCell>
                <TableCell className="text-right font-semibold">
                  <Amount value={month.darf} />
                  {month.pendingAfter !== "0.00" ? (
                    <div className="text-[11px] font-normal text-muted-foreground">
                      <Trans id="incomeTax.monthly.pending">
                        {formatMoney(month.pendingAfter, "BRL")} carried
                      </Trans>
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  <DarfPaymentCell
                    month={month}
                    onEdit={() => setPaying(month)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>
                <Trans id="incomeTax.monthly.total">Year</Trans>
              </TableCell>
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell />
              <TableCell className="text-right">
                <Amount value={report.totals.taxDue} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {brl(report.totals.withheld)} /{" "}
                {brl(report.totals.withheldDayTrade)}
              </TableCell>
              <TableCell />
              <TableCell className="text-right font-semibold">
                <Amount value={report.totals.darf} />
              </TableCell>
              <TableCell className="text-right font-semibold">
                <Amount value={report.totals.darfPaid} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
        {paying ? (
          <DarfPaymentDialog
            month={paying.month}
            monthLabel={`${monthLabel(paying.month)} ${paying.month.slice(0, 4)}`}
            due={paying.darf}
            paid={paying.darfPaid}
            paidOn={paying.darfPaidOn}
            onClose={() => setPaying(null)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function kindLabel(kind: TaxKind, dayTrade = false): ReactNode {
  if (dayTrade) return <Trans id="incomeTax.kind.dayTrade">Day trade</Trans>;

  switch (kind) {
    case "stock":
      return <Trans id="incomeTax.kind.stock">Stock</Trans>;
    case "unit":
      return <Trans id="incomeTax.kind.unit">Unit</Trans>;
    case "etf":
      return <Trans id="incomeTax.kind.etf">ETF</Trans>;
    case "bdr":
      return <Trans id="incomeTax.kind.bdr">BDR</Trans>;
    case "fii":
      return <Trans id="incomeTax.kind.fii">FII</Trans>;
    case "foreign":
      return <Trans id="incomeTax.kind.foreign">Foreign</Trans>;
    case "uncovered":
      return <Trans id="incomeTax.kind.uncovered">Not covered</Trans>;
  }
}

/** Stable row keys: the same ticker can sell more than once a day. */
function saleKeys(sales: IncomeTaxReport["sales"]) {
  const seen = new Map<string, number>();

  return sales.map((sale) => {
    const base = `${sale.tradedAt}|${sale.ticker}|${sale.dayTrade}`;
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);

    return { key: `${base}|${occurrence}`, sale };
  });
}

export function SalesTable({ report }: { report: IncomeTaxReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="incomeTax.sales.title">Sales of the year</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="incomeTax.sales.description">
            Every sale behind the figures above, to check against your broker
            notes. Results include fees; foreign results are in reais at each
            trade's PTAX.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {report.sales.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans id="incomeTax.sales.empty">No sales in this year.</Trans>
          </p>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans id="incomeTax.sales.date">Date</Trans>
                </TableHead>
                <TableHead>
                  <Trans id="incomeTax.sales.ticker">Ticker</Trans>
                </TableHead>
                <TableHead>
                  <Trans id="incomeTax.sales.kind">Kind</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.sales.quantity">Quantity</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.sales.gross">Sale value</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.sales.result">Result (R$)</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {saleKeys(report.sales).map(({ key, sale }) => (
                <TableRow key={key}>
                  <TableCell>{formatTradeDate(sale.tradedAt)}</TableCell>
                  <TableCell className="font-medium">{sale.ticker}</TableCell>
                  <TableCell>{kindLabel(sale.kind, sale.dayTrade)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuantity(sale.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(
                      sale.grossNative,
                      sale.kind === "foreign" ? "USD" : "BRL",
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={sale.resultBrl} signed />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function ForeignSection({ report }: { report: IncomeTaxReport }) {
  const { foreign } = report;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="incomeTax.foreign.title">
            Foreign assets (Lei 14.754)
          </Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="incomeTax.foreign.description">
            Assessed once a year in the declaration at 15%. Each sale is
            converted at the BCB PTAX sell rate of its date and the cost at the
            rates of the purchases. Dividends and interest received abroad also
            enter this base and are not included here.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 overflow-x-auto">
        {foreign.assets.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <Trans id="incomeTax.foreign.empty">
              No foreign sales in this year.
            </Trans>
          </p>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans id="incomeTax.foreign.ticker">Ticker</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.foreign.proceedsUsd">Sales (US$)</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.foreign.proceedsBrl">
                    Proceeds (R$)
                  </Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.foreign.cost">Cost (R$)</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.foreign.result">Result (R$)</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {foreign.assets.map((asset) => (
                <TableRow key={asset.ticker}>
                  <TableCell className="font-medium">{asset.ticker}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(asset.proceedsUsd, "USD")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={asset.proceedsBrl} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={asset.costBrl} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={asset.resultBrl} signed />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-5">
          <div>
            <dt className="text-muted-foreground">
              <Trans id="incomeTax.foreign.net">Net result</Trans>
            </dt>
            <dd>
              <Amount value={foreign.netResult} signed />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              <Trans id="incomeTax.foreign.lossBefore">Loss carried in</Trans>
            </dt>
            <dd>
              <Amount value={foreign.lossBefore} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              <Trans id="incomeTax.foreign.base">Taxable base</Trans>
            </dt>
            <dd>
              <Amount value={foreign.base} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              <Trans id="incomeTax.foreign.tax">Tax at 15%</Trans>
            </dt>
            <dd className="font-semibold">
              <Amount value={foreign.estimatedTax} />
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              <Trans id="incomeTax.foreign.lossAfter">Loss carried out</Trans>
            </dt>
            <dd>
              <Amount value={foreign.lossAfter} />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Issuer and broker, appended to the description when known. */
function descriptionSuffix(holding: IncomeTaxHolding): string {
  const parts: string[] = [];
  const name = holding.legalName;
  const cnpj = holding.cnpj;
  const broker = holding.broker;

  if (name && cnpj) {
    parts.push(
      t({
        id: "incomeTax.holdings.descIssuer",
        message: `Issuer: ${name}, CNPJ ${cnpj}.`,
      }),
    );
  } else if (name) {
    parts.push(
      t({
        id: "incomeTax.holdings.descIssuerName",
        message: `Issuer: ${name}.`,
      }),
    );
  } else if (cnpj) {
    parts.push(
      t({
        id: "incomeTax.holdings.descIssuerCnpj",
        message: `Issuer CNPJ ${cnpj}.`,
      }),
    );
  }

  if (broker) {
    parts.push(
      t({ id: "incomeTax.holdings.descBroker", message: `Broker: ${broker}.` }),
    );
  }

  return parts.join(" ");
}

/** Suggested "Discriminação" text for the IRPF form. */
function holdingDescription(holding: IncomeTaxHolding): string {
  const quantity = formatQuantity(holding.quantity);
  const ticker = holding.ticker;
  const suffix = descriptionSuffix(holding);
  const join = (base: string) => (suffix ? `${base} ${suffix}` : base);

  if (holding.kind === "foreign") {
    const cost = holding.costUsd ? formatMoney(holding.costUsd, "USD") : "—";

    return join(
      t({
        id: "incomeTax.holdings.descForeign",
        message: `${quantity} shares of ${ticker}, traded in the United States. Acquisition cost ${cost}.`,
      }),
    );
  }

  // Four decimals, as the declaration usually prints the unit cost.
  const average = holding.averagePrice
    ? formatPreciseMoney(holding.averagePrice, "BRL")
    : "—";

  switch (holding.kind) {
    case "fii":
    case "etf":
      return join(
        t({
          id: "incomeTax.holdings.descQuotas",
          message: `${quantity} quotas of ${ticker}, traded on B3. Average cost per quota ${average}.`,
        }),
      );
    case "bdr":
      return join(
        t({
          id: "incomeTax.holdings.descBdrs",
          message: `${quantity} BDRs of ${ticker}, traded on B3. Average cost per BDR ${average}.`,
        }),
      );
    case "unit":
      return join(
        t({
          id: "incomeTax.holdings.descUnits",
          message: `${quantity} units of ${ticker}, traded on B3. Average cost per unit ${average}.`,
        }),
      );
    default:
      return join(
        t({
          id: "incomeTax.holdings.descShares",
          message: `${quantity} shares of ${ticker}, traded on B3. Average cost per share ${average}.`,
        }),
      );
  }
}

function cashDescription(balance: ForeignCashBalance): string {
  const amount = formatMoney(balance.amountUsd, "USD");
  const institution = balance.institution;

  return institution
    ? t({
        id: "incomeTax.holdings.descCashAt",
        message: `${amount} in a non-remunerated account at ${institution}.`,
      })
    : t({
        id: "incomeTax.holdings.descCash",
        message: `${amount} in a non-remunerated account abroad.`,
      });
}

/** Declaration order inside a location: shares first, then funds. */
const KIND_ORDER: TaxKind[] = [
  "stock",
  "unit",
  "fii",
  "etf",
  "bdr",
  "foreign",
  "uncovered",
];

/** Exact sum of two-decimal amounts; `null` if any amount is unknown. */
function sumCents(values: readonly (string | null)[]): string | null {
  let total = 0n;

  for (const value of values) {
    if (value === null) return null;
    const negative = value.startsWith("-");
    const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
    const cents =
      BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
    total += negative ? -cents : cents;
  }

  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const text = `${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;

  return negative ? `-${text}` : text;
}

type CashRow = {
  before: ForeignCashBalance | null;
  after: ForeignCashBalance | null;
  onEdit: () => void;
};

function EditButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="print:hidden"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <Pencil aria-hidden="true" />
    </Button>
  );
}

function HoldingsGroup({
  title,
  location,
  holdings,
  year,
  previousYear,
  onEdit,
  cash,
}: {
  title: ReactNode;
  location: ReactNode;
  holdings: IncomeTaxHolding[];
  year: number;
  previousYear: number;
  onEdit: (holding: IncomeTaxHolding) => void;
  cash?: CashRow;
}) {
  const count = holdings.length;
  const sorted = [...holdings].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.ticker.localeCompare(b.ticker),
  );
  const cashBalance = cash?.after ?? cash?.before ?? null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-muted-foreground">
          {location} ·{" "}
          <Plural
            id="incomeTax.holdings.count"
            value={count}
            one="# asset"
            other="# assets"
          />
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[860px] table-fixed text-xs">
          <colgroup>
            <col className="w-32" />
            <col className="w-20" />
            <col />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-10 print:hidden" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans id="incomeTax.holdings.ticker">Ticker</Trans>
              </TableHead>
              <TableHead>
                <Trans id="incomeTax.holdings.code">Group / code</Trans>
              </TableHead>
              <TableHead>
                <Trans id="incomeTax.holdings.descriptionColumn">
                  Description
                </Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.holdings.before">
                  31/12/{previousYear}
                </Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="incomeTax.holdings.after">31/12/{year}</Trans>
              </TableHead>
              <TableHead className="print:hidden">
                <span className="sr-only">
                  <Trans id="incomeTax.holdings.actions">Actions</Trans>
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((holding) => {
              const ticker = holding.ticker;

              return (
                <TableRow key={ticker} className="align-top">
                  <TableCell className="font-medium">
                    {ticker}
                    <div className="text-[11px] font-normal text-muted-foreground">
                      {kindLabel(holding.kind)}
                    </div>
                    {holding.cnpj ? (
                      <div className="text-[11px] font-normal tabular-nums text-muted-foreground">
                        {holding.cnpj}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {holding.group && holding.code
                      ? `${holding.group} / ${holding.code}`
                      : "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {holding.quantity === "0.00000000" ? (
                      <span className="text-muted-foreground">
                        <Trans id="incomeTax.holdings.sold">
                          Sold during the year.
                        </Trans>
                      </span>
                    ) : (
                      holdingDescription(holding)
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={holding.costBefore} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={holding.cost} />
                  </TableCell>
                  <TableCell className="print:hidden">
                    <EditButton
                      label={t({
                        id: "incomeTax.holdings.editLabel",
                        message: `Edit the tax details of ${ticker}`,
                      })}
                      onClick={() => onEdit(holding)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {cash ? (
              <TableRow className="align-top">
                <TableCell className="font-medium">
                  US$
                  <div className="text-[11px] font-normal text-muted-foreground">
                    <Trans id="incomeTax.holdings.cashKind">
                      Account abroad
                    </Trans>
                  </div>
                </TableCell>
                <TableCell className="tabular-nums">06 / 01</TableCell>
                <TableCell className="whitespace-normal">
                  {cashBalance ? (
                    cashDescription(cashBalance)
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs print:hidden"
                      onClick={cash.onEdit}
                    >
                      <Trans id="incomeTax.holdings.cashAdd">
                        Enter the dollar balance
                      </Trans>
                    </Button>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={cash.before?.valueBrl ?? null} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={cash.after?.valueBrl ?? null} />
                </TableCell>
                <TableCell className="print:hidden">
                  <EditButton
                    label={t({
                      id: "incomeTax.holdings.cashEditLabel",
                      message: `Edit the dollar balance of 31/12/${year}`,
                    })}
                    onClick={cash.onEdit}
                  />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                <Trans id="incomeTax.holdings.subtotal">Subtotal</Trans>
              </TableCell>
              <TableCell className="text-right font-semibold">
                <Amount
                  value={sumCents([
                    ...sorted.map((holding) => holding.costBefore),
                    cash?.before?.valueBrl ?? "0.00",
                  ])}
                />
              </TableCell>
              <TableCell className="text-right font-semibold">
                <Amount
                  value={sumCents([
                    ...sorted.map((holding) => holding.cost),
                    cash?.after?.valueBrl ?? "0.00",
                  ])}
                />
              </TableCell>
              <TableCell className="print:hidden" />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </section>
  );
}

export function HoldingsTable({ report }: { report: IncomeTaxReport }) {
  // Re-renders the descriptions when the locale changes.
  useLingui();
  const [editing, setEditing] = useState<IncomeTaxHolding | null>(null);
  const [editingCash, setEditingCash] = useState(false);
  const year = report.year;
  const previousYear = year - 1;
  const brazil = report.holdings.filter(
    (holding) => holding.currency === "BRL",
  );
  const abroad = report.holdings.filter(
    (holding) => holding.currency === "USD",
  );
  const { before, after } = report.foreignCash;
  const showAbroad = abroad.length > 0 || before !== null || after !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="incomeTax.holdings.title">Bens e Direitos</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="incomeTax.holdings.description">
            Holdings at cost on 31 December of {previousYear} and {year}, as
            declared. Foreign assets are in reais at the rates of their
            purchases. Group and code are suggested only where they are
            unambiguous.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {report.holdings.length === 0 && !showAbroad ? (
          <p className="text-sm text-muted-foreground">
            <Trans id="incomeTax.holdings.empty">
              Nothing held at the end of either year.
            </Trans>
          </p>
        ) : null}
        {brazil.length > 0 ? (
          <HoldingsGroup
            title={<Trans id="incomeTax.holdings.groupBrazil">Brazil</Trans>}
            location={
              <Trans id="incomeTax.holdings.brazil">105 – Brazil</Trans>
            }
            holdings={brazil}
            year={year}
            previousYear={previousYear}
            onEdit={setEditing}
          />
        ) : null}
        {showAbroad ? (
          <HoldingsGroup
            title={<Trans id="incomeTax.holdings.groupAbroad">Abroad</Trans>}
            location={
              <Trans id="incomeTax.holdings.usa">249 – United States</Trans>
            }
            holdings={abroad}
            year={year}
            previousYear={previousYear}
            onEdit={setEditing}
            cash={{ before, after, onEdit: () => setEditingCash(true) }}
          />
        ) : null}
      </CardContent>
      {editing ? (
        <AssetProfileDialog
          holding={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {editingCash ? (
        <ForeignCashDialog
          year={year}
          balance={after}
          onClose={() => setEditingCash(false)}
        />
      ) : null}
    </Card>
  );
}

/** Rendimentos Isentos e Não Tributáveis that come from buys and sells. */
export function ExemptIncomeCard({ report }: { report: IncomeTaxReport }) {
  const hasStockGain = report.totals.exemptGain !== "0.00";

  if (!hasStockGain && report.bonuses.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="incomeTax.exempt.title">Exempt income</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="incomeTax.exempt.description">
            Rendimentos Isentos e Não Tributáveis sheet. Dividends and other
            income are not included here.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 overflow-x-auto text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
          <span>
            <Trans id="incomeTax.exempt.stockGain">
              Type 20 – stock sales up to R$ 20,000 a month
            </Trans>
          </span>
          <span className="font-semibold tabular-nums">
            {brl(report.totals.exemptGain)}
          </span>
        </div>
        {report.bonuses.length > 0 ? (
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans id="incomeTax.exempt.bonusSource">
                    Type 18 – bonus shares: paying source
                  </Trans>
                </TableHead>
                <TableHead>
                  <Trans id="incomeTax.exempt.bonusCnpj">CNPJ</Trans>
                </TableHead>
                <TableHead>
                  <Trans id="incomeTax.exempt.bonusDate">Ex-date</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.exempt.bonusShares">Shares</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="incomeTax.exempt.bonusValue">Value</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.bonuses.map((bonus) => (
                <TableRow key={`${bonus.ticker}-${bonus.effectiveAt}`}>
                  <TableCell className="font-medium">
                    {bonus.legalName ?? bonus.ticker}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {bonus.cnpj ?? (
                      <span className="text-muted-foreground">
                        <Trans id="incomeTax.exempt.bonusCnpjMissing">
                          Add it in Bens e Direitos
                        </Trans>
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{formatTradeDate(bonus.effectiveAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuantity(bonus.quantity)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={bonus.value} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </CardContent>
    </Card>
  );
}
