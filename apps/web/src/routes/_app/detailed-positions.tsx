import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { positiveDecimal } from "@portifolio-tracker/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, Columns3, Plus, RotateCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  columnLabels,
  initialColumns,
  PRESETS,
  type PresetName,
  persistColumns,
} from "@/components/detailed-positions/columns";
import { PositionsTable } from "@/components/detailed-positions/positions-table";
import { comparePositions } from "@/components/detailed-positions/sorting";
import {
  ErrorCard,
  MonthSelector,
  TableSkeleton,
} from "@/components/detailed-positions/toolbar";
import {
  COLUMN_IDS,
  type ColumnId,
  type SortState,
} from "@/components/detailed-positions/types";
import { PageContent } from "@/components/page-content";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/api";
import { useFxQuote, useFxRequest } from "@/lib/fx";
import { lastTwelveMonths } from "@/lib/months";
import { useSettings } from "@/lib/settings";
import { isFxRateRequired, queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/detailed-positions")({
  component: DetailedPositionsPage,
});

function DetailedPositionsPage() {
  const { i18n } = useLingui();
  const { displayCurrency, quoteSource, manualPrices } = useSettings();
  const months = useMemo(() => lastTwelveMonths(), []);
  const [monthKey, setMonthKey] = useState(months[0]?.key ?? "");
  const [search, setSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [visibleColumns, setVisibleColumns] =
    useState<Set<ColumnId>>(initialColumns);
  const [sort, setSort] = useState<SortState>({
    id: "marketValue",
    direction: "desc",
  });
  const selected = months.find((month) => month.key === monthKey) ?? months[0];
  const fx = useFxQuote(selected?.asOf);
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

  const positions = trpc.positions.list.useQuery({
    displayCurrency,
    ...fxRequest,
    asOf: selected?.asOf ?? undefined,
    quoteSource,
    manualPrices:
      quoteSource === "manual" && Object.keys(sanitizedManualPrices).length > 0
        ? sanitizedManualPrices
        : undefined,
  });

  const waitingForRate =
    !!positions.error && isFxRateRequired(positions.error) && fx.isPending;
  const fxFailed =
    !!positions.error &&
    isFxRateRequired(positions.error) &&
    fx.fxSource !== "manual" &&
    !!fx.error;

  const labels = columnLabels(i18n);
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase(i18n.locale);
    const filtered = (positions.data?.positions ?? []).filter((position) => {
      if (!showClosed && Number(position.quantity) === 0) return false;
      if (!needle) return true;
      return `${position.ticker} ${position.assetClass} ${position.currency}`
        .toLocaleLowerCase(i18n.locale)
        .includes(needle);
    });
    return filtered.sort((a, b) =>
      comparePositions(a, b, sort.id, sort.direction),
    );
  }, [positions.data, search, showClosed, sort, i18n.locale]);

  function updateColumns(next: Set<ColumnId>) {
    setVisibleColumns(next);
    persistColumns(next);
  }

  function applyPreset(preset: PresetName) {
    updateColumns(new Set(PRESETS[preset]));
  }

  function toggleColumn(id: ColumnId) {
    if (id === "ticker") return;
    const next = new Set(visibleColumns);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    updateColumns(next);
  }

  function toggleSort(id: ColumnId) {
    setSort((current) =>
      current.id === id
        ? { id, direction: current.direction === "asc" ? "desc" : "asc" }
        : {
            id,
            direction:
              id === "ticker" || id === "assetClass" || id === "currency"
                ? "asc"
                : "desc",
          },
    );
  }

  return (
    <PageContent width="wide" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="detailedPositions.title">Detailed positions</Trans>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Trans id="detailedPositions.subtitle">
              Inspect your holdings in a dense, customizable view. Choose a
              preset or select exactly which columns to display.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthSelector
            months={months}
            selectedKey={selected?.key ?? ""}
            onSelect={setMonthKey}
            locale={i18n.locale}
          />
          <Button asChild size="sm">
            <Link to="/transactions">
              <Plus aria-hidden="true" />
              <Trans id="positions.registerTrade">Register a trade</Trans>
            </Link>
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-xs">
          <Search
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={i18n._(
              t({
                id: "detailedPositions.searchLabel",
                message: "Search detailed positions",
              }),
            )}
            placeholder={i18n._(
              t({
                id: "detailedPositions.search",
                message: "Search ticker or class…",
              }),
            )}
            className="h-8 pl-8"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant={showClosed ? "secondary" : "outline"}
          aria-pressed={showClosed}
          onClick={() => setShowClosed((current) => !current)}
        >
          <Trans id="detailedPositions.showClosed">Show closed positions</Trans>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ml-auto"
            >
              <Columns3 aria-hidden="true" />
              <Trans id="detailedPositions.columns">Columns</Trans>
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <Trans id="detailedPositions.presets">View presets</Trans>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => applyPreset("compact")}>
              <Trans id="detailedPositions.compact">Compact</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyPreset("standard")}>
              <Trans id="detailedPositions.standard">Standard</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => applyPreset("all")}>
              <Trans id="detailedPositions.all">All data</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <Trans id="detailedPositions.customize">Customize columns</Trans>
            </DropdownMenuLabel>
            {COLUMN_IDS.map((id) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={visibleColumns.has(id)}
                disabled={id === "ticker"}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleColumn(id)}
              >
                {labels[id]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => applyPreset("standard")}>
              <RotateCcw aria-hidden="true" />
              <Trans id="detailedPositions.reset">Reset to standard</Trans>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {positions.isPending || waitingForRate ? <TableSkeleton /> : null}
      {fxFailed ? (
        <ErrorCard>
          <Trans id="positions.fxFailed">
            Could not fetch the exchange rate. Try another source or enter it
            manually.
          </Trans>
        </ErrorCard>
      ) : null}
      {positions.error && !waitingForRate && !fxFailed ? (
        <ErrorCard>{queryErrorMessage(positions.error)}</ErrorCard>
      ) : null}
      {positions.data ? (
        <PositionsTable
          rows={rows}
          visibleColumns={visibleColumns}
          labels={labels}
          sort={sort}
          onSort={toggleSort}
          displayCurrency={displayCurrency}
          summary={positions.data.summary}
          missing={positions.data.quotes.missing}
        />
      ) : null}
    </PageContent>
  );
}
