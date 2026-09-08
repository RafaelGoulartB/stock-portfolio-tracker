import type {
  NextResult,
  NextResultsResponse,
} from "@portifolio-tracker/shared";
import { alphaVantageResultProvider } from "./alpha-vantage";
import { cvmB3ResultProvider } from "./cvm-b3";
import type { ResultDateAsset, ResultDateProvider } from "./provider";
import { yahooResultProvider } from "./yahoo";

const CONCURRENCY = 4;

type ResultProviders = {
  brazil: ResultDateProvider;
  unitedStates: ResultDateProvider;
  fallback: ResultDateProvider;
};

const defaultProviders: ResultProviders = {
  brazil: cvmB3ResultProvider,
  unitedStates: alphaVantageResultProvider,
  fallback: yahooResultProvider,
};

async function resolveWithFallback(
  asset: ResultDateAsset,
  today: string,
  primary: ResultDateProvider,
  fallback: ResultDateProvider,
): Promise<NextResult | null> {
  try {
    const result = await primary.getNextResult(asset, today);
    if (result) return result;
  } catch {
    // A primary provider failure must not prevent the independent fallback.
  }

  try {
    return await fallback.getNextResult(asset, today);
  } catch {
    return null;
  }
}

export function createResultDateService(
  providers: ResultProviders,
  now: () => Date = () => new Date(),
) {
  return async function getNextResults(
    assets: ResultDateAsset[],
    today: string,
  ): Promise<NextResultsResponse> {
    const uniqueByTicker = new Map<string, ResultDateAsset>();
    for (const asset of assets) {
      const key = asset.ticker.trim().toUpperCase();
      if (key && !uniqueByTicker.has(key)) uniqueByTicker.set(key, asset);
    }
    const uniqueAssets = [...uniqueByTicker.values()];
    const results: NextResult[] = [];
    let cursor = 0;

    const worker = async () => {
      while (cursor < uniqueAssets.length) {
        const index = cursor;
        cursor += 1;
        const asset = uniqueAssets[index];
        if (!asset) continue;

        const primary =
          asset.assetClass === "stock_br"
            ? providers.brazil
            : asset.assetClass === "stock_us"
              ? providers.unitedStates
              : null;
        if (!primary) continue;

        const result = await resolveWithFallback(
          asset,
          today,
          primary,
          providers.fallback,
        );
        if (result) results.push(result);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(CONCURRENCY, uniqueAssets.length) },
        worker,
      ),
    );

    results.sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.ticker.localeCompare(right.ticker),
    );

    return { results, checkedAt: now().toISOString() };
  };
}

export const getNextResults = createResultDateService(defaultProviders);
