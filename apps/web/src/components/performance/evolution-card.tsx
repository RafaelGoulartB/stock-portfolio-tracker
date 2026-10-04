import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CurrencyCode } from "@/lib/format";
import { CumulativeChart } from "./return-cards";
import type { MonthRow } from "./types";
import { ValueChart } from "./value-card";

type View = "value" | "return";

/** The portfolio over time, either as money or as a time-weighted return. */
export function EvolutionCard({
  rows,
  currency,
}: {
  rows: MonthRow[];
  currency: CurrencyCode;
}) {
  const [view, setView] = useState<View>("value");

  return (
    <Card>
      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <CardTitle>
              {view === "value" ? (
                <Trans id="performance.valueTitle">Value and cost basis</Trans>
              ) : (
                <Trans id="performance.cumulativeTitle">
                  Cumulative return
                </Trans>
              )}
            </CardTitle>
            <CardDescription>
              {view === "value" ? (
                <Trans id="performance.valueHint">
                  The gap between the two lines is the open result: value above
                  cost is gain, below is loss. In {currency}.
                </Trans>
              ) : (
                <Trans id="performance.cumulativeDrawdownHint">
                  Time-weighted return since the start of the window, so
                  contributions never inflate it. The shaded area is how far the
                  curve sits below its previous peak.
                </Trans>
              )}
            </CardDescription>
          </div>
          <div className="shrink-0">
            <TabsList>
              <TabsTrigger value="value">
                <Trans id="performance.tabValue">Value</Trans>
              </TabsTrigger>
              <TabsTrigger value="return">
                <Trans id="performance.tabReturn">Return</Trans>
              </TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <TabsContent value="value">
            <ValueChart rows={rows} currency={currency} />
          </TabsContent>
          <TabsContent value="return">
            <CumulativeChart rows={rows} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
