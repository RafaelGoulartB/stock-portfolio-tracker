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
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/api";

/** Seed button rendered at the bottom of the settings modal in dev builds. */
export function DevSeedSection() {
  const { i18n } = useLingui();
  const utils = trpc.useUtils();

  const seed = trpc.devSeed.seedDemo.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.transactions.list.invalidate(),
        utils.positions.list.invalidate(),
      ]);

      const base = i18n._(
        msg({
          id: "settings.devSeed.success",
          message: `${result.inserted} demo transactions added`,
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
    <div className="grid gap-3">
      <Separator />
      <div className="rounded-md border border-dashed p-3">
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
            Adds demo buys and sells across stocks, ETFs, REITs, crypto and
            fixed income to the signed-in account. Only for local testing, never
            for production use.
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
    </div>
  );
}
