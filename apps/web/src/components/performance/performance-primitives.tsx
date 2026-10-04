import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((item) => (
            <div key={item} className="space-y-2 bg-card px-5 py-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </Card>
      {[288, 236].map((height) => (
        <Card key={height}>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="w-full" style={{ height }} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
