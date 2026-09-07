import { CASH_TICKER } from "@portifolio-tracker/shared";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AssetLink({
  ticker,
  children,
  className,
  title,
}: {
  ticker: string;
  children?: ReactNode;
  className?: string;
  title?: string;
}) {
  if (ticker === CASH_TICKER) {
    return <span className={className}>{children ?? ticker}</span>;
  }

  return (
    <Link
      to="/assets/$ticker"
      params={{ ticker }}
      title={title}
      className={cn(
        "rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children ?? ticker}
    </Link>
  );
}
