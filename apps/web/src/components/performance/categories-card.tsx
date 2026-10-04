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
import { CategoryTable } from "./category-table";
import { CompositionChart } from "./composition-card";
import type {
  Category,
  ClassBreakdown,
  MonthRow,
  PerformanceSummary,
} from "./types";

type View = "today" | "history";

/** Where the money sits by category: today's result, or the mix over time. */
export function CategoriesCard({
  rows,
  breakdown,
  summary,
  categories,
}: {
  rows: MonthRow[];
  breakdown: ClassBreakdown[];
  summary: PerformanceSummary;
  categories: Category[];
}) {
  const [view, setView] = useState<View>("today");
  const currency = summary.displayCurrency;

  return (
    <Card>
      <Tabs value={view} onValueChange={(value) => setView(value as View)}>
        <CardHeader className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <CardTitle>
              <Trans id="performance.categoriesTitle">Categories</Trans>
            </CardTitle>
            <CardDescription>
              {view === "today" ? (
                <Trans id="performance.categoryTableHint">
                  Contribution is how many percentage points of the portfolio
                  result come from each category.
                </Trans>
              ) : (
                <Trans id="performance.compositionHint">
                  How the mix of categories evolved, in {currency}.
                </Trans>
              )}
            </CardDescription>
          </div>
          <div className="shrink-0">
            <TabsList>
              <TabsTrigger value="today">
                <Trans id="performance.tabToday">Today</Trans>
              </TabsTrigger>
              <TabsTrigger value="history">
                <Trans id="performance.tabOverTime">Over time</Trans>
              </TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <TabsContent value="today">
            <CategoryTable
              breakdown={breakdown}
              summary={summary}
              categories={categories}
            />
          </TabsContent>
          <TabsContent value="history">
            <CompositionChart
              rows={rows}
              categories={categories}
              currency={currency}
            />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
