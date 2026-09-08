import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import { ExternalLink, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { externalAssetLinks } from "@/lib/external-asset-links";
import { cn } from "@/lib/utils";

export function ExternalAssetLinksMenu({
  ticker,
  assetClass,
  currency,
  className,
}: {
  ticker: string;
  assetClass: AssetClass;
  currency: Currency;
  className?: string;
}) {
  const { i18n } = useLingui();
  const links = externalAssetLinks(ticker, assetClass, currency);

  if (links.length === 0) return null;

  const label = i18n._(
    t({
      id: "allocation.externalLinksFor",
      message: `External links for ${ticker}`,
    }),
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-6", className)}
          aria-label={label}
          title={label}
        >
          <ExternalLink aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {links.map((link) => (
          <DropdownMenuItem key={link.id} asChild>
            <a href={link.href} target="_blank" rel="noopener noreferrer">
              {link.id === "investorRelations" ? (
                <Search aria-hidden="true" />
              ) : (
                <ExternalLink aria-hidden="true" />
              )}
              {link.id === "fundamentei" ? (
                <Trans id="allocation.openFundamentei">Fundamentei</Trans>
              ) : link.id === "tradingView" ? (
                <Trans id="allocation.openTradingView">TradingView</Trans>
              ) : (
                <Trans id="allocation.findInvestorRelations">
                  Investor relations website
                </Trans>
              )}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
