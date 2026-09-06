import { formatDecimal, toDecimal } from "../decimal";
import { toYahooSymbol } from "../quotes/yahoo";
import {
  type DividendEvent,
  type DividendProvider,
  type DividendRequest,
  DividendUnavailableError,
} from "./provider";

const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const cache = new Map<string, { events: DividendEvent[]; expiresAt: number }>();

function dayToUnix(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, date) / 1_000);
}

function unixToDay(timestamp: number): string {
  return new Date(timestamp * 1_000).toISOString().slice(0, 10);
}

type YahooDividend = { amount?: number; date?: number };

/** Free historical dividend events from the same chart feed used for quotes. */
export class YahooDividendProvider implements DividendProvider {
  readonly id = "yahoo" as const;
  readonly label = "Yahoo Finance (free)";

  async getDividends(request: DividendRequest): Promise<DividendEvent[]> {
    const symbol = toYahooSymbol(
      request.ticker,
      request.assetClass,
      request.currency,
    );

    if (!symbol) {
      throw new DividendUnavailableError(request.ticker);
    }

    const key = `${symbol}|${request.start}|${request.end}`;
    const hit = cache.get(key);

    if (hit && hit.expiresAt > Date.now()) {
      return hit.events;
    }

    let response: Response;

    try {
      response = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&period1=${dayToUnix(request.start)}&period2=${dayToUnix(request.end) + 86400}&events=div%2Csplits`,
        {
          headers: { "User-Agent": USER_AGENT },
          signal: AbortSignal.timeout(12_000),
        },
      );
    } catch (error) {
      throw new DividendUnavailableError(
        request.ticker,
        error instanceof Error ? error.message : "Yahoo request failed",
      );
    }

    if (!response.ok) {
      throw new DividendUnavailableError(
        request.ticker,
        `Yahoo request failed (${response.status})`,
      );
    }

    const body = (await response.json()) as {
      chart?: {
        result?: Array<{
          events?: { dividends?: Record<string, YahooDividend> };
        }> | null;
        error?: { description?: string } | null;
      };
    };
    const result = body.chart?.result?.[0];

    if (!result) {
      throw new DividendUnavailableError(
        request.ticker,
        body.chart?.error?.description,
      );
    }

    const events = Object.values(result.events?.dividends ?? {})
      .flatMap((item): DividendEvent[] => {
        if (
          item.date == null ||
          item.amount == null ||
          !Number.isFinite(item.amount) ||
          item.amount <= 0
        ) {
          return [];
        }

        const exDate = unixToDay(item.date);
        const amountPerShare = formatDecimal(
          toDecimal(item.amount.toFixed(8)),
          8,
        );

        return [
          {
            id: `yahoo:${symbol}:${exDate}:${amountPerShare}`,
            ticker: request.ticker,
            currency: request.currency,
            amountPerShare,
            declarationDate: null,
            exDate,
            recordDate: null,
            paymentDate: null,
            source: this.id,
          },
        ];
      })
      .filter(
        (event) => event.exDate >= request.start && event.exDate <= request.end,
      )
      .sort((a, b) => b.exDate.localeCompare(a.exDate));

    cache.set(key, { events, expiresAt: Date.now() + CACHE_TTL_MS });
    return events;
  }
}

export function clearYahooDividendCache(): void {
  cache.clear();
}
