import type { NextResult } from "@portifolio-tracker/shared";
import { parse } from "csv-parse/sync";
import { unzipSync } from "fflate";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  ParsedResultEvent,
  ResultDateAsset,
  ResultDateProvider,
} from "./provider";

const B3_COMPANY_URL =
  "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies";
const CVM_ARCHIVE_URL =
  "https://dados.cvm.gov.br/dados/cia_aberta/DOC/IPE/DADOS";
const USER_AGENT =
  "PortfolioTracker/1.0 (+https://github.com; public CVM/B3 data)";

const DIRECTORY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MANIFEST_TTL_MS = 12 * 60 * 60 * 1_000;
const DOCUMENT_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MISSING_TTL_MS = 6 * 60 * 60 * 1_000;
const FAILURE_TTL_MS = 30 * 60 * 1_000;
const MAX_ARCHIVE_BYTES = 12 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_PDF_PAGES = 10;

type Timed<T> = { value: T; expiresAt: number };

type CvmCalendarDocument = {
  codeCvm: string;
  referenceYear: number;
  deliveredAt: string;
  version: number;
  downloadUrl: string;
};

type CvmCsvRow = {
  Codigo_CVM?: string;
  Data_Referencia?: string;
  Categoria?: string;
  Data_Entrega?: string;
  Versao?: string;
  Link_Download?: string;
};

const companyCodeCache = new Map<string, Timed<string | null>>();
const companyCodePending = new Map<string, Promise<string | null>>();
const manifestCache = new Map<number, Timed<CvmCalendarDocument[]>>();
const manifestPending = new Map<number, Promise<CvmCalendarDocument[]>>();
const documentCache = new Map<string, Timed<ParsedResultEvent[] | null>>();
const documentPending = new Map<string, Promise<ParsedResultEvent[] | null>>();

function cacheValue<T>(entry: Timed<T> | undefined): T | undefined {
  return entry && entry.expiresAt > Date.now() ? entry.value : undefined;
}

function setTimed<T>(
  cache: Map<string, Timed<T>>,
  key: string,
  value: T,
  ttl: number,
): T {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}

function encodePayload(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

async function fetchBytes(url: string, maxBytes: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Upstream request failed (${response.status})`);
  }

  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error("Upstream response exceeded the size limit");
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new Error("Upstream response exceeded the size limit");
  }

  return bytes;
}

async function loadCompanyCode(ticker: string): Promise<string | null> {
  const hit = cacheValue(companyCodeCache.get(ticker));
  if (hit !== undefined) return hit;

  const inFlight = companyCodePending.get(ticker);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const payload = encodePayload({
        language: "pt-br",
        pageNumber: 1,
        pageSize: 20,
        company: ticker,
      });
      const response = await fetch(`${B3_COMPANY_URL}/${payload}`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) throw new Error("B3 company lookup failed");

      const body = (await response.json()) as {
        results?: Array<{ codeCVM?: string; issuingCompany?: string }>;
      };
      const expectedIssuer = ticker.replace(/\d+$/, "");
      const exact = body.results?.find(
        (item) => item.issuingCompany?.toUpperCase() === expectedIssuer,
      );
      const code = exact?.codeCVM?.trim() || null;

      return setTimed(
        companyCodeCache,
        ticker,
        code,
        code ? DIRECTORY_TTL_MS : MISSING_TTL_MS,
      );
    } catch {
      return setTimed(companyCodeCache, ticker, null, FAILURE_TTL_MS);
    }
  })();
  companyCodePending.set(ticker, request);

  try {
    return await request;
  } finally {
    companyCodePending.delete(ticker);
  }
}

export function parseCvmManifestArchive(
  bytes: Uint8Array,
): CvmCalendarDocument[] {
  const files = unzipSync(bytes, {
    filter: (entry) =>
      entry.name.toLowerCase().endsWith(".csv") &&
      entry.originalSize <= 64 * 1024 * 1024,
  });
  const csv = Object.values(files)[0];
  if (!csv) throw new Error("CVM archive has no CSV manifest");

  const text = new TextDecoder("windows-1252").decode(csv);
  const rows = parse(text, {
    bom: true,
    columns: true,
    delimiter: ";",
    skip_empty_lines: true,
    relax_column_count: true,
    // The official IPE export contains unescaped quotes in free-text subjects.
    // Calendar rows remain columnar, so tolerate those unrelated malformed rows.
    relax_quotes: true,
  }) as CvmCsvRow[];

  return rows.flatMap((row): CvmCalendarDocument[] => {
    if (row.Categoria !== "Calendário de Eventos Corporativos") return [];

    const codeCvm = row.Codigo_CVM?.trim();
    const referenceYear = Number(row.Data_Referencia?.slice(0, 4));
    const version = Number(row.Versao);
    const downloadUrl = row.Link_Download?.trim();
    const deliveredAt = row.Data_Entrega?.trim();

    if (
      !codeCvm ||
      !Number.isInteger(referenceYear) ||
      !Number.isInteger(version) ||
      !downloadUrl?.startsWith("https://www.rad.cvm.gov.br/") ||
      !deliveredAt ||
      !/^\d{4}-\d{2}-\d{2}$/.test(deliveredAt)
    ) {
      return [];
    }

    return [{ codeCvm, referenceYear, deliveredAt, version, downloadUrl }];
  });
}

async function loadManifestYear(year: number): Promise<CvmCalendarDocument[]> {
  const hit = cacheValue(manifestCache.get(year));
  if (hit !== undefined) return hit;

  const inFlight = manifestPending.get(year);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const bytes = await fetchBytes(
        `${CVM_ARCHIVE_URL}/ipe_cia_aberta_${year}.zip`,
        MAX_ARCHIVE_BYTES,
      );
      const documents = parseCvmManifestArchive(bytes);
      manifestCache.set(year, {
        value: documents,
        expiresAt: Date.now() + MANIFEST_TTL_MS,
      });
      return documents;
    } catch {
      manifestCache.set(year, {
        value: [],
        expiresAt: Date.now() + FAILURE_TTL_MS,
      });
      return [];
    }
  })();
  manifestPending.set(year, request);

  try {
    return await request;
  } finally {
    manifestPending.delete(year);
  }
}

/** Latest submission wins for each calendar year, including re-presentations. */
export function latestCalendarDocuments(
  rows: readonly CvmCalendarDocument[],
  codeCvm: string,
  firstReferenceYear: number,
): CvmCalendarDocument[] {
  const latest = new Map<number, CvmCalendarDocument>();

  for (const row of rows) {
    if (
      row.codeCvm !== codeCvm ||
      row.referenceYear < firstReferenceYear ||
      row.referenceYear > firstReferenceYear + 1
    ) {
      continue;
    }

    const current = latest.get(row.referenceYear);
    if (
      !current ||
      row.deliveredAt > current.deliveredAt ||
      (row.deliveredAt === current.deliveredAt && row.version > current.version)
    ) {
      latest.set(row.referenceYear, row);
    }
  }

  return [...latest.values()].sort(
    (left, right) => left.referenceYear - right.referenceYear,
  );
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[–—]/g, "-")
    .toLowerCase();
}

function brDateToIso(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;

  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10) === iso ? iso : null;
}

function section(
  text: string,
  startLabel: string,
  endLabels: readonly string[],
  maxLength: number,
): string {
  const start = text.indexOf(startLabel);
  if (start < 0) return "";

  let end = Math.min(text.length, start + maxLength);
  for (const label of endLabels) {
    const candidate = text.indexOf(label, start + startLabel.length);
    if (candidate >= 0 && candidate < end) end = candidate;
  }

  return text.slice(start, end);
}

/** Parses the regular, text-based calendar generated by Empresas.NET. */
export function parseCvmCalendarText(
  rawText: string,
  referenceYear: number,
): ParsedResultEvent[] {
  const text = normalizeText(rawText);
  const events: ParsedResultEvent[] = [];
  const annual = section(
    text,
    "demonstracoes financeiras anuais",
    ["formulario de referencia", "informacoes trimestrais"],
    700,
  );
  const annualDates = [...annual.matchAll(/\d{2}\/\d{2}\/\d{4}/g)]
    .map((match) => brDateToIso(match[0]))
    .filter((date): date is string => date !== null);
  const annualDate =
    annualDates.find((date) => date.startsWith(`${referenceYear}-`)) ??
    annualDates.at(-1);

  if (annualDate) {
    events.push({
      date: annualDate,
      period: `FY${String(referenceYear - 1).slice(-2)}`,
    });
  }

  const quarterly = section(
    text,
    "informacoes trimestrais - itr",
    [
      "informacoes trimestrais traduzidas",
      "assembleia geral",
      "apresentacao publica",
      "lista de reunioes",
    ],
    1_000,
  );

  for (const match of quarterly.matchAll(
    /referentes? ao\s+([123])(?:o|º)?\s+trimestre[\s\S]{0,100}?(\d{2}\/\d{2}\/\d{4})/g,
  )) {
    const quarter = Number(match[1]);
    const date = brDateToIso(match[2] ?? "");
    if (date && quarter >= 1 && quarter <= 3) {
      events.push({
        date,
        period: `${quarter}Q${String(referenceYear).slice(-2)}`,
      });
    }
  }

  return events.filter(
    (event, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.date === event.date && candidate.period === event.period,
      ) === index,
  );
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const loadingTask = getDocument({
    data: bytes,
    useSystemFonts: true,
    useWorkerFetch: false,
  });

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error("CVM calendar PDF has too many pages");
    }

    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .map((item) =>
            "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
          )
          .join(""),
      );
      page.cleanup();
    }

    return pages.join("\n");
  } finally {
    await loadingTask.destroy();
  }
}

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  let lastError: unknown;

  // RAD occasionally returns a transient HTML/error body with HTTP 200.
  // Retry once here, then let the short failure cache schedule a later attempt.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const bytes = await fetchBytes(url, MAX_PDF_BYTES);
      if (!isPdf(bytes)) throw new Error("CVM response is not a PDF");
      return bytes;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("CVM calendar PDF could not be downloaded");
}

async function loadDocumentEvents(
  document: CvmCalendarDocument,
): Promise<ParsedResultEvent[] | null> {
  const key = document.downloadUrl;
  const hit = cacheValue(documentCache.get(key));
  if (hit !== undefined) return hit;

  const inFlight = documentPending.get(key);
  if (inFlight) return inFlight;

  const request = (async () => {
    try {
      const bytes = await fetchPdfBytes(document.downloadUrl);
      const text = await extractPdfText(bytes);
      const events = parseCvmCalendarText(text, document.referenceYear);
      return setTimed(
        documentCache,
        key,
        events.length > 0 ? events : null,
        events.length > 0 ? DOCUMENT_TTL_MS : MISSING_TTL_MS,
      );
    } catch {
      return setTimed(documentCache, key, null, FAILURE_TTL_MS);
    }
  })();
  documentPending.set(key, request);

  try {
    return await request;
  } finally {
    documentPending.delete(key);
  }
}

export function selectNextResult(
  events: readonly ParsedResultEvent[],
  today: string,
): ParsedResultEvent | null {
  return (
    events
      .filter((event) => event.date >= today)
      .sort(
        (left, right) =>
          left.date.localeCompare(right.date) ||
          (left.period ?? "").localeCompare(right.period ?? ""),
      )[0] ?? null
  );
}

export class CvmB3ResultDateProvider implements ResultDateProvider {
  async getNextResult(
    asset: ResultDateAsset,
    today: string,
  ): Promise<NextResult | null> {
    if (asset.assetClass !== "stock_br") return null;

    const ticker = asset.ticker.trim().toUpperCase();
    const codeCvm = await loadCompanyCode(ticker);
    if (!codeCvm) return null;

    const year = Number(today.slice(0, 4));
    const manifests = (
      await Promise.all([loadManifestYear(year - 1), loadManifestYear(year)])
    ).flat();
    const documents = latestCalendarDocuments(manifests, codeCvm, year);
    if (documents.length === 0) return null;

    const events = (
      await Promise.all(
        documents.map((document) => loadDocumentEvents(document)),
      )
    ).flatMap((result) => result ?? []);
    const next = selectNextResult(events, today);

    return next
      ? {
          ticker,
          date: next.date,
          period: next.period,
          source: "cvm_b3",
          estimated: false,
        }
      : null;
  }
}

export function clearCvmB3ResultCaches(): void {
  companyCodeCache.clear();
  companyCodePending.clear();
  manifestCache.clear();
  manifestPending.clear();
  documentCache.clear();
  documentPending.clear();
}

export const cvmB3ResultProvider: ResultDateProvider =
  new CvmB3ResultDateProvider();
