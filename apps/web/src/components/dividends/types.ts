import type { ChartConfig } from "@/components/ui/chart";
import type { RouterOutputs } from "@/lib/api";

export type DividendData = RouterOutputs["dividends"]["history"];
export type DividendEvent = DividendData["events"][number];

export const chartConfig = {
  amount: { label: "Income", color: "var(--chart-2)" },
} satisfies ChartConfig;
