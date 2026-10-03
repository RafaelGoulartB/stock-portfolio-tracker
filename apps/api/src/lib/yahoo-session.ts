const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const SESSION_TTL_MS = 60 * 60 * 1_000;

export type YahooCredentials = { cookie: string; crumb: string };

function normalizeCookie(headers: Headers): string | null {
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  const values = getSetCookie?.length
    ? getSetCookie
    : [headers.get("set-cookie")].filter((value): value is string => !!value);
  const cookie = values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");

  return cookie || null;
}

/**
 * Yahoo's authenticated endpoints (`v7/finance/quote`, `quoteSummary`) need a
 * consent cookie plus a matching crumb. Both cost two upstream calls, so one
 * pair is shared by every caller for an hour and concurrent misses wait on the
 * same handshake. A 401/403 from a consumer should `invalidate()` the
 * credentials it used and retry once.
 */
export class YahooSession {
  private credentials: (YahooCredentials & { expiresAt: number }) | null = null;
  private pending: Promise<YahooCredentials> | null = null;

  constructor(
    // Resolved per call so test stubs of the global `fetch` apply.
    private readonly fetchImpl: typeof fetch = (input, init) =>
      fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<YahooCredentials> {
    if (this.credentials && this.credentials.expiresAt > this.now()) {
      return this.credentials;
    }

    this.pending ??= this.handshake().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /**
   * Drops the shared pair. Given the pair a request was refused with, it only
   * drops that pair, so a late refusal cannot discard credentials another
   * caller has just renewed. Without an argument it always clears.
   */
  invalidate(failed?: YahooCredentials): void {
    if (!failed || this.credentials === failed) {
      this.credentials = null;
    }
  }

  private async handshake(): Promise<YahooCredentials> {
    const cookieResponse = await this.fetchImpl("https://fc.yahoo.com/", {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    if (
      !cookieResponse.ok &&
      ![301, 302, 404].includes(cookieResponse.status)
    ) {
      throw new Error(`Yahoo cookie request failed (${cookieResponse.status})`);
    }

    const cookie = normalizeCookie(cookieResponse.headers);
    if (!cookie) throw new Error("Yahoo did not return a session cookie");

    const crumbResponse = await this.fetchImpl(
      "https://query2.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: { Cookie: cookie, "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!crumbResponse.ok) {
      throw new Error(`Yahoo crumb request failed (${crumbResponse.status})`);
    }

    const crumb = (await crumbResponse.text()).trim();
    if (!crumb) throw new Error("Yahoo did not return a crumb");

    this.credentials = {
      cookie,
      crumb,
      expiresAt: this.now() + SESSION_TTL_MS,
    };
    return this.credentials;
  }
}

/** Process-wide session shared by the quote and result providers. */
export const yahooSession = new YahooSession();
