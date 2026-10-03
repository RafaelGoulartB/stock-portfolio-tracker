import { portfolioQueryInput } from "@/lib/allocation-query";
import { trpcQueryUtils } from "@/lib/api";
import { readStoredSettings } from "@/lib/settings";

/**
 * Starts a page's main queries from its route loader, so they run while the
 * page's code chunk downloads instead of after it renders. The loader does not
 * await them: the page still renders its own loading state, and its hooks
 * attach to these same in-flight requests. Hover preloads are skipped so
 * merely pointing at a link never spends database or provider quota.
 */
export function prefetchPortfolio(
  preload: boolean,
  prefetch: (input: ReturnType<typeof portfolioQueryInput>) => unknown[],
): void {
  if (preload) {
    return;
  }

  const input = portfolioQueryInput(readStoredSettings());

  for (const pending of prefetch(input)) {
    // Errors surface through the page's own query; nothing to report here.
    void Promise.resolve(pending).catch(() => undefined);
  }
}

export { trpcQueryUtils };
