import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { Plus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function EmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <span className="rounded-full bg-muted p-3">
          <Wallet className="size-5 text-muted-foreground" aria-hidden="true" />
        </span>
        <p className="max-w-sm text-sm text-muted-foreground">
          <Trans id="positions.empty">
            No positions yet. Register your first trade to see it here.
          </Trans>
        </p>
        <Button asChild size="sm">
          <Link to="/transactions">
            <Plus className="size-4" aria-hidden="true" />
            <Trans id="positions.registerTrade">Register a trade</Trans>
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function PositionsSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[136px]" />
      <Skeleton className="h-[420px]" />
      <Skeleton className="h-[248px]" />
      <Skeleton className="h-72" />
    </div>
  );
}
