import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

const BRAND = "Portfolio Tracker";

/** Keeps the browser title aligned with both the active route and locale. */
export function DocumentTitle() {
  const { i18n } = useLingui();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const locale = i18n.locale;

  useEffect(() => {
    if (i18n.locale !== locale) return;

    const page = titleForPath(pathname, i18n);
    document.title = page ? `${page} · ${BRAND}` : BRAND;
  }, [i18n, locale, pathname]);

  return null;
}

function titleForPath(
  pathname: string,
  i18n: ReturnType<typeof useLingui>["i18n"],
): string | null {
  if (pathname === "/" || pathname === "/login") {
    return pathname === "/login"
      ? i18n._(msg({ id: "document.login", message: "Sign in" }))
      : null;
  }

  const assetMatch = /^\/(?:assets|allocation)\/([^/]+)$/.exec(pathname);
  if (assetMatch?.[1]) {
    const ticker = decodeURIComponent(assetMatch[1]);
    return i18n._(
      t({
        id: "document.asset",
        message: `${ticker} details`,
      }),
    );
  }

  if (pathname.startsWith("/allocation")) {
    return i18n._(msg({ id: "document.allocation", message: "Allocation" }));
  }
  if (pathname === "/positions") {
    return i18n._(msg({ id: "document.positions", message: "Positions" }));
  }
  if (pathname === "/detailed-positions") {
    return i18n._(
      msg({
        id: "document.detailedPositions",
        message: "Detailed positions",
      }),
    );
  }
  if (pathname === "/performance") {
    return i18n._(msg({ id: "document.performance", message: "Performance" }));
  }
  if (pathname === "/daily") {
    return i18n._(msg({ id: "document.daily", message: "Daily performance" }));
  }
  if (pathname === "/deep-finder") {
    return i18n._(msg({ id: "document.deepFinder", message: "Deep Finder" }));
  }
  if (pathname === "/dividends") {
    return i18n._(msg({ id: "document.income", message: "Income" }));
  }
  if (pathname === "/categories") {
    return i18n._(msg({ id: "document.categories", message: "My categories" }));
  }
  if (pathname === "/transactions") {
    return i18n._(
      msg({ id: "document.transactions", message: "Transactions" }),
    );
  }

  return null;
}
