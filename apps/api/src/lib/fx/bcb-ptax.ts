import { coalesce, pruneExpired } from "../async";
import { div, formatDecimal, toDecimal } from "../decimal";
import type {
  FxProvider,
  FxQuote,
  FxQuoteRequest,
  FxSeriesPoint,
  FxSeriesRequest,
} from "./provider";

type SeriesCacheEntry = { points: FxSeriesPoint[]; expiresAt: number };

/** PTAX closes are final once published; today's may still be pending. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
/** A range that ends before today in São Paulo can no longer change. */
const SETTLED_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
/** Long enough to cross Carnival or a year-end holiday run. */
const LOOKBACK_DAYS = 10;
const ENDPOINT =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";

const seriesCache = new Map<string, SeriesCacheEntry>();
const pendingSeries = new Map<string, Promise<FxSeriesPoint[]>>();
const buyRateCache = new Map<
  string,
  { point: FxSeriesPoint | null; expiresAt: number }
>();
const pendingBuyRates = new Map<string, Promise<FxSeriesPoint | null>>();

function ttlFor(lastDay: string): number {
  return lastDay < saoPauloToday() ? SETTLED_TTL_MS : CACHE_TTL_MS;
}

/** Today in São Paulo, where PTAX is published, `YYYY-MM-DD`. */
export function saoPauloToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, date + days));

  return cursor.toISOString().slice(0, 10);
}

/** The OData endpoint takes `MM-DD-YYYY` between single quotes. */
function odataDay(day: string): string {
  const [year, month, date] = day.split("-");

  return `'${month}-${date}-${year}'`;
}

/** Last point at or before `day`; `points` must be ascending. */
export function ptaxOnOrBefore(
  points: readonly FxSeriesPoint[],
  day: string,
): FxSeriesPoint | null {
  let found: FxSeriesPoint | null = null;

  for (const point of points) {
    if (point.asOf > day) break;
    found = point;
  }

  return found;
}

/**
 * Official Banco Central do Brasil PTAX, no API key. `rate` is the closing
 * PTAX *sell* rate (`cotacaoVenda`), BRL per 1 USD — the reference used to
 * convert foreign-asset costs and proceeds into reais.
 *
 * PTAX exists only on Brazilian business days, so a weekend or holiday
 * resolves to the previous published close and reports that day in `asOf`.
 */
export class BcbPtaxProvider implements FxProvider {
  readonly id = "bcb_ptax" as const;
  readonly label = "BCB PTAX (Banco Central do Brasil)";

  async getQuote({ from, to, asOf }: FxQuoteRequest): Promise<FxQuote> {
    const day = asOf ?? saoPauloToday();

    if (from === to) {
      return { from, to, rate: "1", asOf: day, source: this.id };
    }

    const points = await this.getSeries({
      from: "USD",
      to: "BRL",
      start: shiftDays(day, -LOOKBACK_DAYS),
      end: day,
    });
    const point = ptaxOnOrBefore(points, day);

    if (!point) {
      throw new Error(`BCB PTAX has no USD/BRL rate on or before ${day}`);
    }

    const rate =
      from === "USD"
        ? point.rate
        : formatDecimal(div(toDecimal("1"), toDecimal(point.rate)), 8);

    return { from, to, rate, asOf: point.asOf, source: this.id };
  }

  /** One request covers the whole range; BCB serves years per call. */
  async getSeries({
    from,
    to,
    start,
    end,
  }: FxSeriesRequest): Promise<FxSeriesPoint[]> {
    if (from === to) {
      return [{ asOf: start, rate: "1" }];
    }

    if (from !== "USD" || to !== "BRL") {
      throw new Error("BCB PTAX series is served as BRL per USD only");
    }

    const key = `${this.id}|${start}..${end}`;
    const hit = seriesCache.get(key);

    if (hit && hit.expiresAt > Date.now()) {
      return hit.points;
    }

    return coalesce(pendingSeries, key, async () => {
      const query = new URLSearchParams({
        "@dataInicial": odataDay(start),
        "@dataFinalCotacao": odataDay(end),
        $format: "json",
        $select: "cotacaoVenda,dataHoraCotacao",
      });
      const response = await fetch(`${ENDPOINT}?${query}`, {
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`BCB PTAX request failed (${response.status})`);
      }

      const points = parsePtaxSeries(await response.json());

      pruneExpired(seriesCache);
      seriesCache.set(key, { points, expiresAt: Date.now() + ttlFor(end) });
      return points;
    });
  }
}

/**
 * Validates the OData payload. A malformed or non-positive row is skipped
 * rather than turned into a rate; a body with no usable row is an error, so
 * an empty range never reads as a valid quote.
 */
export function parsePtaxSeries(
  body: unknown,
  field: PtaxField = "cotacaoVenda",
): FxSeriesPoint[] {
  const rows =
    typeof body === "object" && body !== null && "value" in body
      ? (body as { value: unknown }).value
      : null;

  if (!Array.isArray(rows)) {
    throw new Error("BCB PTAX returned an unexpected payload");
  }

  const byDay = new Map<string, string>();

  for (const row of rows) {
    const record = (row ?? {}) as Record<string, unknown>;
    const quote = record[field];
    const { dataHoraCotacao } = record;

    if (
      typeof quote !== "number" ||
      !Number.isFinite(quote) ||
      quote <= 0 ||
      typeof dataHoraCotacao !== "string" ||
      !/^\d{4}-\d{2}-\d{2}/.test(dataHoraCotacao)
    ) {
      continue;
    }

    // Later bulletins of the same day replace earlier ones.
    byDay.set(
      dataHoraCotacao.slice(0, 10),
      formatDecimal(toDecimal(String(quote)), 8),
    );
  }

  if (byDay.size === 0) {
    throw new Error("BCB PTAX returned no USD/BRL rate for the range");
  }

  return [...byDay]
    .map(([asOf, rate]) => ({ asOf, rate }))
    .sort((a, b) => a.asOf.localeCompare(b.asOf));
}

type PtaxField = "cotacaoVenda" | "cotacaoCompra";

/**
 * The PTAX *buy* rate of `day` or the last business day before it. The IRPF
 * converts foreign balances held on 31 December at this rate; trades keep
 * using the sell rate.
 */
export async function ptaxBuyRateOnOrBefore(
  day: string,
): Promise<FxSeriesPoint | null> {
  const hit = buyRateCache.get(day);

  if (hit && hit.expiresAt > Date.now()) {
    return hit.point;
  }

  return coalesce(pendingBuyRates, day, async () => {
    const point = await fetchBuyRateOnOrBefore(day);
    pruneExpired(buyRateCache);
    buyRateCache.set(day, { point, expiresAt: Date.now() + ttlFor(day) });
    return point;
  });
}

async function fetchBuyRateOnOrBefore(
  day: string,
): Promise<FxSeriesPoint | null> {
  const query = new URLSearchParams({
    "@dataInicial": odataDay(shiftDays(day, -LOOKBACK_DAYS)),
    "@dataFinalCotacao": odataDay(day),
    $format: "json",
    $select: "cotacaoCompra,dataHoraCotacao",
  });
  const response = await fetch(`${ENDPOINT}?${query}`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`BCB PTAX request failed (${response.status})`);
  }

  return ptaxOnOrBefore(
    parsePtaxSeries(await response.json(), "cotacaoCompra"),
    day,
  );
}

/** Clears cached series. Exported for tests. */
export function clearPtaxCache(): void {
  seriesCache.clear();
  pendingSeries.clear();
  buyRateCache.clear();
  pendingBuyRates.clear();
}
