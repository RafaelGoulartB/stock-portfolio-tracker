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
const cache = new Map<string, CacheEntry>();

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

    let response: Response;

    try {
      const url = new URL("https://www.alphavantage.co/query");
      url.searchParams.set("function", "DIVIDENDS");
      url.searchParams.set("symbol", request.ticker);
      url.searchParams.set("apikey", this.apiKey);
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
      throw new DividendUnavailableError(
        request.ticker,
        body.Information ??
          body.Note ??
          body["Error Message"] ??
          "Invalid Alpha Vantage response",
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

    cache.set(request.ticker, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      events,
    });

    return filterRange(events, request);
  }
}

function filterRange(
  events: DividendEvent[],
  request: DividendRequest,
): DividendEvent[] {
  return events.filter(
    (event) => event.exDate >= request.start && event.exDate <= request.end,
  );
}
