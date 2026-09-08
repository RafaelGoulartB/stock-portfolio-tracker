import { Trans } from "@lingui/react/macro";
import type { AssetClass, Currency } from "@portifolio-tracker/shared";
import { memo, useState } from "react";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

const publishableKey = import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY?.trim();
const FAILED_LOGO_RETRY_MS = 5 * 60 * 1_000;
const MAX_FAILED_LOGOS = 200;
const failedLogoUntil = new Map<string, number>();

function suppressFailedLogo(src: string): boolean {
  const retryAt = failedLogoUntil.get(src);

  if (retryAt === undefined) {
    return false;
  }

  if (retryAt <= Date.now()) {
    failedLogoUntil.delete(src);
    return false;
  }

  return true;
}

function rememberFailedLogo(src: string): void {
  const now = Date.now();

  for (const [key, retryAt] of failedLogoUntil) {
    if (retryAt <= now) {
      failedLogoUntil.delete(key);
    }
  }

  if (failedLogoUntil.size >= MAX_FAILED_LOGOS) {
    const oldest = failedLogoUntil.keys().next().value;
    if (oldest) {
      failedLogoUntil.delete(oldest);
    }
  }

  failedLogoUntil.set(src, now + FAILED_LOGO_RETRY_MS);
}

const COMPANY_ASSET_CLASSES = new Set<AssetClass>([
  "stock_br",
  "stock_us",
  "reit",
  "etf",
  "bdr",
]);

/** Maps the portfolio identity to Logo.dev's exchange-qualified identifier. */
export function toLogoDevIdentifier(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency,
): string | null {
  const normalized = ticker.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  if (assetClass === "crypto") {
    const symbol = normalized.endsWith("USD")
      ? normalized.slice(0, -3)
      : normalized;

    return symbol ? `crypto/${symbol}` : null;
  }

  if (!COMPANY_ASSET_CLASSES.has(assetClass)) {
    return null;
  }

  const isB3Listing =
    assetClass === "stock_br" || assetClass === "bdr" || currency === "BRL";
  const symbol =
    isB3Listing && !normalized.endsWith(".SA")
      ? `${normalized}.SA`
      : normalized;

  return `ticker/${symbol}`;
}

export function assetLogoUrl(
  ticker: string,
  assetClass: AssetClass,
  currency: Currency,
): string | null {
  const identifier = toLogoDevIdentifier(ticker, assetClass, currency);

  if (!publishableKey || !identifier) {
    return null;
  }

  const parameters = new URLSearchParams({
    token: publishableKey,
    size: "64",
    format: "webp",
    retina: "true",
    theme: "auto",
    fallback: "404",
  });

  return `https://img.logo.dev/${identifier}?${parameters.toString()}`;
}

function AssetLogoComponent({
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
  const { showLogos } = useSettings();
  const src = showLogos ? assetLogoUrl(ticker, assetClass, currency) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const retrySuppressed = src ? suppressFailedLogo(src) : false;

  const frameClassName = cn(
    "size-7 shrink-0 rounded-md border bg-background",
    className,
  );

  if (!src || failedSrc === src || retrySuppressed) {
    return (
      <span
        className={cn(
          frameClassName,
          "flex items-center justify-center text-[9px] font-semibold text-muted-foreground",
        )}
        aria-hidden="true"
      >
        {ticker.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt=""
      width={28}
      height={28}
      loading="lazy"
      decoding="async"
      referrerPolicy="origin"
      className={cn(frameClassName, "object-contain p-0.5")}
      onError={() => {
        rememberFailedLogo(src);
        setFailedSrc(src);
      }}
    />
  );
}

export function LogoDevAttribution({ className }: { className?: string }) {
  if (!publishableKey) {
    return null;
  }

  return (
    <a
      href="https://logo.dev"
      target="_blank"
      rel="noopener"
      className={cn("text-xs text-muted-foreground hover:underline", className)}
    >
      <Trans id="logoDev.attribution">Logos provided by Logo.dev</Trans>
    </a>
  );
}

/** Memoized: one instance per table row, and its props are all primitives. */
export const AssetLogo = memo(AssetLogoComponent);
