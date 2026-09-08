import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  PERFORMANCE_WINDOWS,
  type PerformanceWindow,
} from "@portifolio-tracker/shared";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function WindowSelector({
  months,
  onSelect,
}: {
  months: PerformanceWindow;
  onSelect: (months: PerformanceWindow) => void;
}) {
  const { i18n } = useLingui();

  return (
    <>
      <Label htmlFor="performance-window" className="sr-only">
        <Trans id="performance.window">History window</Trans>
      </Label>
      <Select
        value={String(months)}
        onValueChange={(value) => onSelect(Number(value) as PerformanceWindow)}
      >
        <SelectTrigger
          id="performance-window"
          size="sm"
          className="w-full max-w-[152px] sm:w-[152px]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERFORMANCE_WINDOWS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {i18n._(
                t({
                  id: "performance.windowMonths",
                  message: plural(
                    { count: option },
                    { one: "Last # month", other: "Last # months" },
                  ),
                }),
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

export function ErrorCard({ children }: { children: ReactNode }) {
  return (
    <Card>
      <CardContent className="py-6 text-sm text-destructive">
        {children}
      </CardContent>
    </Card>
  );
}

export function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
        <p className="text-sm text-muted-foreground">
          <Trans id="performance.empty">
            Register trades to build a performance history.
          </Trans>
        </p>
        <Button asChild size="sm">
          <Link to="/transactions">
            <Plus className="size-4" aria-hidden="true" />
            <Trans id="performance.registerTrade">Register a trade</Trans>
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function NoReturnYet() {
  return (
    <p className="py-16 text-center text-sm text-muted-foreground">
      <Trans id="performance.noReturnYet">
        Not enough history yet: a return needs a month that starts with a
        position.
      </Trans>
    </p>
  );
}

/** One tooltip row: colored marker, label and a right-aligned amount. */
export function TooltipRow({
  color,
  label,
  value,
  valueClassName,
  dashed = false,
}: {
  color: string;
  label: ReactNode;
  value: string;
  valueClassName?: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex w-full items-center gap-2">
      <span
        className={`size-2.5 shrink-0 rounded-[2px] ${dashed ? "border-[1.5px] border-dashed" : ""}`}
        style={
          dashed
            ? { borderColor: color, backgroundColor: "transparent" }
            : { backgroundColor: color }
        }
        aria-hidden="true"
      />
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`ml-auto pl-3 font-medium tabular-nums ${valueClassName ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}

export function PerformanceSkeleton() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <Card className="gap-0 overflow-hidden py-0">
        <div className="grid divide-y sm:grid-cols-2 sm:divide-x lg:grid-cols-5 lg:divide-y-0">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="space-y-2 px-5 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[288px] w-full" />
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((item) => (
          <Card key={item}>
            <CardHeader>
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-56 max-w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[236px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
