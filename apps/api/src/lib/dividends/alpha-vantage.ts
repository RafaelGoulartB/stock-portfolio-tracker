import {
  alphaVantageBlocked,
  noteAlphaVantageRefusal,
} from "../alpha-vantage-quota";
import { pruneExpired } from "../async";
import { formatDecimal, toDecimal } from "../decimal";
import {
  type DividendEvent,
  type DividendProvider,
  type DividendRequest,
  DividendUnavailableError,
} from "./provider";

type AlphaDividend = {
  ex_dividend_date?: string;
  declaration_date?: string;
  record_date?: string;
  payment_date?: string;
  amount?: string;
};

type CacheEntry = {
  expiresAt: number;
  events: DividendEvent[];
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
/** A failed ticker is not retried sooner; Yahoo answers meanwhile. */
const FAILURE_TTL_MS = 60 * 60 * 1_000;
const cache = new Map<string, CacheEntry>();
const failures = new Map<string, { message: string; expiresAt: number }>();
const pending = new Map<string, Promise<DividendEvent[]>>();

function nullableDay(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Free-key provider for US events, including declared future payments. */
export class AlphaVantageDividendProvider implements DividendProvider {
  readonly id = "alpha_vantage" as const;
  readonly label = "Alpha Vantage (free API key)";

  constructor(private readonly apiKey: string | undefined) {}

  async getDividends(request: DividendRequest): Promise<DividendEvent[]> {
    if (!this.apiKey) {
      throw new DividendUnavailableError(
        request.ticker,
        "Set ALPHA_VANTAGE_API_KEY to use Alpha Vantage",
      );
    }

    if (request.currency !== "USD" || request.assetClass === "stock_br") {
      throw new DividendUnavailableError(
        request.ticker,
        "Alpha Vantage fallback is enabled for US assets only",
      );
    }

    const cached = cache.get(request.ticker);
    if (cached && cached.expiresAt > Date.now()) {
      return filterRange(cached.events, request);
    }

    const inFlight = pending.get(request.ticker);
    if (inFlight) {
      return filterRange(await inFlight, request);
    }

    const refusal =
      alphaVantageBlocked() ??
      (() => {
        const failure = failures.get(request.ticker);
        return failure && failure.expiresAt > Date.now()
          ? failure.message
          : null;
      })();
    if (refusal) {
      throw new DividendUnavailableError(request.ticker, refusal);
    }

    const result = this.fetchAndCache(request);
    pending.set(request.ticker, result);

    try {
      return filterRange(await result, request);
    } catch (error) {
      pruneExpired(failures);
      failures.set(request.ticker, {
        message:
          error instanceof Error ? error.message : "Alpha Vantage failed",
        expiresAt: Date.now() + FAILURE_TTL_MS,
      });
      throw error;
    } finally {
      pending.delete(request.ticker);
    }
  }

  private async fetchAndCache(
    request: DividendRequest,
  ): Promise<DividendEvent[]> {
    const apiKey = this.apiKey;
    if (!apiKey) {
      throw new DividendUnavailableError(
        request.ticker,
        "Set ALPHA_VANTAGE_API_KEY to use Alpha Vantage",
      );
    }

    let response: Response;

    try {
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", "DIVIDENDS");
      url.searchParams.set("symbol", request.ticker);
      url.searchParams.set("apikey", apiKey);
      response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    } catch (error) {
      throw new DividendUnavailableError(
        request.ticker,
        error instanceof Error ? error.message : "Alpha Vantage request failed",
      );
    }

    if (!response.ok) {
      throw new DividendUnavailableError(
        request.ticker,
        `Alpha Vantage request failed (${response.status})`,
      );
    }

    const body = (await response.json()) as {
      data?: AlphaDividend[];
      Information?: string;
      Note?: string;
      "Error Message"?: string;
    };

    if (!Array.isArray(body.data)) {
      const refusal = body.Information ?? body.Note;
      if (refusal) {
        noteAlphaVantageRefusal(refusal);
      }
      throw new DividendUnavailableError(
        request.ticker,
        refusal ?? body["Error Message"] ?? "Invalid Alpha Vantage response",
      );
    }

    const events = body.data
      .flatMap((item): DividendEvent[] => {
        const exDate = nullableDay(item.ex_dividend_date);

        if (!exDate || !item.amount) {
          return [];
        }

        let amountPerShare: string;
        try {
          const amount = toDecimal(item.amount);
          if (amount <= 0n) {
            return [];
          }
          amountPerShare = formatDecimal(amount, 8);
        } catch {
          return [];
        }

        return [
          {
            id: `alpha_vantage:${request.ticker}:${exDate}:${amountPerShare}`,
            ticker: request.ticker,
            currency: request.currency,
            amountPerShare,
            declarationDate: nullableDay(item.declaration_date),
            exDate,
            recordDate: nullableDay(item.record_date),
            paymentDate: nullableDay(item.payment_date),
            source: this.id,
          },
        ];
      })
      .sort((a, b) => b.exDate.localeCompare(a.exDate));

    pruneExpired(cache);
    cache.set(request.ticker, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      events,
    });

    return filterRange(events, request);
  }
}

/** Clears cached events and remembered failures. Exported for tests. */
export function clearAlphaVantageDividendCache(): void {
  cache.clear();
  failures.clear();
  pending.clear();
}

function filterRange(
  events: DividendEvent[],
  request: DividendRequest,
): DividendEvent[] {
  return events.filter(
    (event) => event.exDate >= request.start && event.exDate <= request.end,
  );
}
