// DEV-ONLY UI for manual testing. This component is never rendered in
// production builds: `SettingsDialog` only mounts it when
// `import.meta.env.DEV` is true, and the `devSeed.seedDemo` endpoint it
// calls refuses to run when the API runs with NODE_ENV=production.
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/api";

/** Seed button rendered at the bottom of the settings modal in dev builds. */
export function DevSeedSection() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();

  const seed = trpc.devSeed.seedDemo.useMutation({
    onSuccess: async (result) => {
      // The seed writes trades, allocation rows and quarterly reviews, which
      // fan out into every derived screen. Invalidate whole routers so
      // sibling procedures (daily, per-ticker ledgers, finders, dividends,
      // performance) refresh too, not just the two list views.
      await Promise.all([
        utils.transactions.invalidate(),
        utils.positions.invalidate(),
        utils.allocation.invalidate(),
        utils.dividends.invalidate(),
        utils.performance.invalidate(),
      ]);

      const base = i18n._(
        msg({
          id: "settings.devSeed.success",
          message: `${result.inserted} trades, ${result.assetsInserted} allocation rows, ${result.reviewsInserted} reviews added`,
        }),
      );
      const skipped =
        result.skippedTickers.length > 0
          ? ` (${i18n._(
              msg({
                id: "settings.devSeed.skipped",
                message: `Skipped: ${result.skippedTickers.join(", ")}`,
              }),
            )})`
          : "";

      toast.success(`${base}${skipped}`);
    },
    onError: () =>
      toast.error(
        i18n._(
          msg({
            id: "settings.devSeed.error",
            message: "Could not add demo data. Try again.",
          }),
        ),
      ),
  });

  // Belt and suspenders: even if a production bundle ever included this
  // module, it renders nothing outside development mode.
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <FlaskConical
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">
          <Trans id="settings.devSeed.title">Test data</Trans>
        </p>
        <Badge variant="outline" className="ml-auto">
          <Trans id="settings.devSeed.badge">Development only</Trans>
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        <Trans id="settings.devSeed.description">
          Adds a 25+ asset demo book: mixed BRL/USD trades, targets, quarterly
          grades, notes and fair values. Existing tickers are skipped, so a
          second click only fills what is still missing. Local testing only.
        </Trans>
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-3 w-full"
        disabled={seed.isPending}
        onClick={() => seed.mutate()}
      >
        {seed.isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <FlaskConical className="size-4" aria-hidden="true" />
        )}
        <Trans id="settings.devSeed.action">Add demo test data</Trans>
      </Button>
    </div>
  );
}
