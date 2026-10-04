import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  DIVIDEND_SOURCE_LABELS,
  DIVIDEND_WINDOWS,
  type DividendSource,
  type DividendWindow,
} from "@portifolio-tracker/shared";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { DividendSourceLabel } from "@/components/dividends/badges";
import {
  DividendsContent,
  DividendsSkeleton,
} from "@/components/dividends/content";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { trpc } from "@/lib/api";
import { useFxRequest } from "@/lib/fx";
import { useSettings } from "@/lib/settings";
import { queryErrorMessage } from "@/lib/trpcErrors";

export const Route = createFileRoute("/_app/dividends")({
  component: DividendsPage,
});

function DividendsPage() {
  const { i18n } = useLingui();
  const { displayCurrency } = useSettings();
  const fxRequest = useFxRequest();
  const [source, setSource] = useState<DividendSource>("auto");
  const [years, setYears] = useState<DividendWindow>(3);
  const dividends = trpc.dividends.history.useQuery(
    {
      source,
      years,
      displayCurrency,
      ...fxRequest,
    },
    {
      staleTime: 6 * 60 * 60 * 1_000,
      gcTime: 6 * 60 * 60 * 1_000,
      // A new window keeps the last one on screen instead of a skeleton.
      placeholderData: (previous) => previous,
    },
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            <Trans id="dividends.title">Income</Trans>
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            <Trans id="dividends.subtitle">
              Estimated dividends based on the shares held before each ex-date.
              Payment dates appear when the provider publishes them.
            </Trans>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={String(years)}
            onValueChange={(value) =>
              value && setYears(Number(value) as DividendWindow)
            }
            aria-label={i18n._(
              msg({ id: "dividends.windowLabel", message: "History window" }),
            )}
          >
            {DIVIDEND_WINDOWS.map((window) => (
              <ToggleGroupItem
                key={window}
                value={String(window)}
                className="px-3 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                <Trans id="dividends.windowShort">{window}Y</Trans>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={source}
            onValueChange={(value) => setSource(value as DividendSource)}
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-[200px]"
              aria-label={i18n._(
                msg({ id: "dividends.sourceLabel", message: "Income source" }),
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(DIVIDEND_SOURCE_LABELS) as DividendSource[]).map(
                (provider) => (
                  <SelectItem key={provider} value={provider}>
                    <DividendSourceLabel source={provider} />
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => dividends.refetch()}
            disabled={dividends.isFetching}
          >
            <RefreshCw
              className={`size-4 ${dividends.isFetching ? "animate-spin" : ""}`}
            />
            <Trans id="dividends.refresh">Refresh</Trans>
          </Button>
        </div>
      </header>

      {dividends.isPending ? <DividendsSkeleton /> : null}
      {dividends.error ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            {queryErrorMessage(dividends.error)}
          </CardContent>
        </Card>
      ) : null}
      {dividends.data ? <DividendsContent data={dividends.data} /> : null}
    </div>
  );
}
