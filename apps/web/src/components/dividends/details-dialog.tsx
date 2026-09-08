import { Trans } from "@lingui/react/macro";
import { CircleDollarSign } from "lucide-react";
import type { ReactNode } from "react";
import { AssetLink } from "@/components/asset-link";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTitleIcon,
} from "@/components/ui/dialog";
import { formatMoney, formatQuantity, formatTradeDate } from "@/lib/format";
import { DividendSourceLabel, StatusBadge } from "./badges";
import { formatOptionalDate } from "./calendar-utils";
import type { DividendEvent } from "./types";

export function DividendDetailsDialog({
  event,
  onOpenChange,
}: {
  event: DividendEvent | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={event !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {event ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-3">
                <DialogTitleIcon>
                  <CircleDollarSign aria-hidden="true" />
                </DialogTitleIcon>
                <span>
                  <AssetLink ticker={event.ticker}>{event.ticker}</AssetLink> ·{" "}
                  <Trans id="dividends.details">Income details</Trans>
                </span>
              </DialogTitle>
              <DialogDescription>
                <Trans id="dividends.detailsDescription">
                  Estimated gross income based on the position held before the
                  ex-date.
                </Trans>
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-lg border bg-muted/30 px-4 py-4 text-sm">
              <DividendDetail
                label={<Trans id="dividends.estimated">Estimated</Trans>}
                value={formatMoney(event.grossAmount, event.currency)}
                prominent
              />
              <DividendDetail
                label={<Trans id="dividends.status">Status</Trans>}
                value={<StatusBadge status={event.status} />}
              />
              <DividendDetail
                label={<Trans id="dividends.shares">Shares</Trans>}
                value={formatQuantity(event.eligibleQuantity)}
              />
              <DividendDetail
                label={<Trans id="dividends.perShare">Per share</Trans>}
                value={formatMoney(event.amountPerShare, event.currency)}
              />
              <DividendDetail
                label={
                  <Trans id="dividends.declarationDate">Declaration</Trans>
                }
                value={formatOptionalDate(event.declarationDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.exDate">Ex-date</Trans>}
                value={formatTradeDate(event.exDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.recordDate">Record date</Trans>}
                value={formatOptionalDate(event.recordDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.paymentDate">Payment date</Trans>}
                value={formatOptionalDate(event.paymentDate)}
              />
              <DividendDetail
                label={<Trans id="dividends.source">Source</Trans>}
                value={<DividendSourceLabel source={event.source} />}
              />
            </dl>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DividendDetail({
  label,
  value,
  prominent = false,
}: {
  label: ReactNode;
  value: ReactNode;
  prominent?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          prominent ? "text-lg font-semibold tabular-nums" : "font-medium"
        }
      >
        {value}
      </dd>
    </div>
  );
}
