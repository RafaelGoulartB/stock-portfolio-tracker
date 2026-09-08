import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type {
  AllocationMarkColor,
  AllocationRow,
} from "@portifolio-tracker/shared";
import { ALLOCATION_MARK_COLORS } from "@portifolio-tracker/shared";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  Eraser,
  ExternalLink,
  Eye,
  MoreVertical,
  Search,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { externalAssetLinks } from "@/lib/external-asset-links";
import { cn } from "@/lib/utils";
import { MARK_DOT } from "./marks";

export function RowMenu({
  row,
  freeOrder,
  onMove,
  onClear,
  onRemove,
  onSetMarkColor,
}: {
  row: AllocationRow;
  freeOrder: boolean;
  onMove: (offset: number) => void;
  onClear: () => void;
  onRemove: () => void;
  onSetMarkColor: (markColor: AllocationMarkColor | null) => void;
}): ReactNode {
  const { i18n } = useLingui();
  const externalLinks = externalAssetLinks(
    row.ticker,
    row.assetClass,
    row.currency,
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={i18n._(
            t({
              id: "allocation.rowMenu",
              message: `Actions for ${row.ticker}`,
            }),
          )}
        >
          <MoreVertical className="size-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild>
          <Link to="/assets/$ticker" params={{ ticker: row.ticker }}>
            <Eye aria-hidden="true" />
            <Trans id="allocation.viewDetails">View details</Trans>
          </Link>
        </DropdownMenuItem>
        {externalLinks.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ExternalLink aria-hidden="true" />
              <Trans id="allocation.externalLinks">External links</Trans>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              {externalLinks.map((link) => (
                <DropdownMenuItem key={link.id} asChild>
                  <a href={link.href} target="_blank" rel="noopener noreferrer">
                    {link.id === "fundamentei" ? (
                      <ExternalLink aria-hidden="true" />
                    ) : (
                      <Search aria-hidden="true" />
                    )}
                    {link.id === "fundamentei" ? (
                      <Trans id="allocation.openFundamentei">Fundamentei</Trans>
                    ) : (
                      <Trans id="allocation.findInvestorRelations">
                        Investor relations website
                      </Trans>
                    )}
                  </a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          <Trans id="allocation.markColor">Highlight</Trans>
        </DropdownMenuLabel>
        <div className="flex items-center gap-1.5 px-2 pb-1.5">
          {ALLOCATION_MARK_COLORS.map((color) => {
            const selected = row.markColor === color;

            return (
              <button
                key={color}
                type="button"
                aria-label={i18n._(
                  t({
                    id: "allocation.markAs",
                    message: `Mark ${row.ticker} ${color}`,
                  }),
                )}
                aria-pressed={selected}
                onClick={() => onSetMarkColor(color)}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  selected &&
                    "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover",
                )}
              >
                <span
                  className={cn("size-3.5 rounded-full", MARK_DOT[color])}
                  aria-hidden="true"
                />
              </button>
            );
          })}
          <button
            type="button"
            aria-label={i18n._(
              t({
                id: "allocation.clearMark",
                message: `Clear highlight on ${row.ticker}`,
              }),
            )}
            disabled={row.markColor === null}
            onClick={() => onSetMarkColor(null)}
            className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <DropdownMenuSeparator />
        {freeOrder ? (
          <>
            <DropdownMenuItem onSelect={() => onMove(-1)}>
              <ChevronUp aria-hidden="true" />
              <Trans id="allocation.moveUp">Move up</Trans>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onMove(1)}>
              <ChevronDown aria-hidden="true" />
              <Trans id="allocation.moveDown">Move down</Trans>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem onSelect={onClear} disabled={!row.tracked}>
          <Eraser aria-hidden="true" />
          <Trans id="allocation.clearAnalysis">Clear target</Trans>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={onRemove}
          disabled={row.hasPosition || !row.tracked}
        >
          <Trash2 aria-hidden="true" />
          <Trans id="allocation.removeAsset">Stop following</Trans>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
