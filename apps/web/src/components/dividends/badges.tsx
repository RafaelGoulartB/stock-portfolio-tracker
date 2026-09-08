import { Trans } from "@lingui/react/macro";
import type { DividendSource } from "@portifolio-tracker/shared";
import { Badge } from "@/components/ui/badge";
import type { DividendEvent } from "./types";

export function DividendSourceLabel({ source }: { source: DividendSource }) {
  if (source === "auto") {
    return (
      <Trans id="dividends.sourceAuto">
        Automatic (Alpha Vantage + Yahoo fallback)
      </Trans>
    );
  }
  if (source === "alpha_vantage") {
    return (
      <Trans id="dividends.sourceAlpha">Alpha Vantage (free API key)</Trans>
    );
  }
  return <Trans id="dividends.sourceYahoo">Yahoo Finance (free)</Trans>;
}

export function StatusBadge({ status }: { status: DividendEvent["status"] }) {
  if (status === "announced")
    return (
      <Badge variant="outline">
        <Trans id="dividends.announced">Announced</Trans>
      </Badge>
    );
  if (status === "scheduled")
    return (
      <Badge variant="secondary">
        <Trans id="dividends.scheduled">Scheduled</Trans>
      </Badge>
    );
  return (
    <Badge variant="outline">
      <Trans id="dividends.estimatedPaid">Estimated paid</Trans>
    </Badge>
  );
}
