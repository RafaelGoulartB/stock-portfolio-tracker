import type * as React from "react";
import { cn } from "@/lib/utils";

type PageWidth = "standard" | "wide";

type PageContentProps = React.ComponentProps<"div"> & {
  /** Standard pages fit the app frame; wide pages make room for dense tables. */
  width?: PageWidth;
};

const WIDTH_CLASS_NAMES: Record<PageWidth, string> = {
  standard: "",
  wide: "relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 px-3 sm:px-4 lg:px-6",
};

/**
 * Shared content-width pattern for application routes. The app shell owns the
 * normal reading width, while wide pages intentionally break out for tables.
 */
function PageContent({
  width = "standard",
  className,
  ...props
}: PageContentProps) {
  return <div className={cn(WIDTH_CLASS_NAMES[width], className)} {...props} />;
}

export type { PageWidth };
export { PageContent };
