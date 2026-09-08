import { describe, expect, it, vi } from "vitest";
import { YahooResultProvider } from "./yahoo";

const asset = {
  ticker: "AAPL",
  assetClass: "stock_us",
  currency: "USD",
} as const;

function cookieResponse(cookie = "A=session"): Response {
  return new Response("", {
    status: 200,
    headers: { "set-cookie": `${cookie}; Path=/; Secure` },
  });
}

function calendarResponse(earnings: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      quoteSummary: {
        result: status === 200 ? [{ calendarEvents: { earnings } }] : null,
      },
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

function unix(day: string): number {
  return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1_000);
}

describe("YahooResultProvider", () => {
  it("uses the Yahoo cookie and crumb and reads a confirmed calendar event", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cookieResponse())
      .mockResolvedValueOnce(new Response("crumb-value", { status: 200 }))
      .mockResolvedValueOnce(
        calendarResponse({
          earningsDate: [{ raw: unix("2026-10-30"), fmt: "2026-10-30" }],
          isEarningsDateEstimate: false,
          period: "3Q26",
        }),
      );
    const provider = new YahooResultProvider(fetchMock);

    await expect(provider.getNextResult(asset, "2026-09-08")).resolves.toEqual({
      ticker: "AAPL",
      date: "2026-10-30",
      period: "3Q26",
      source: "yahoo",
      estimated: false,
    });
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("crumb=crumb-value");
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toMatchObject({
      Cookie: "A=session",
    });
  });

  it("marks a Yahoo date range as estimated and uses its first future day", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cookieResponse())
      .mockResolvedValueOnce(new Response("crumb", { status: 200 }))
      .mockResolvedValueOnce(
        calendarResponse({
          earningsDate: [
            { raw: unix("2026-10-29") },
            { raw: unix("2026-11-02") },
          ],
          isEarningsDateEstimate: true,
          quarter: "3Q26",
        }),
      );
    const provider = new YahooResultProvider(fetchMock);

    await expect(
      provider.getNextResult(asset, "2026-09-08"),
    ).resolves.toMatchObject({
      date: "2026-10-29",
      estimated: true,
      period: "3Q26",
    });
  });

  it("renews the session once after an unauthorized calendar request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cookieResponse("A=old"))
      .mockResolvedValueOnce(new Response("old-crumb", { status: 200 }))
      .mockResolvedValueOnce(calendarResponse(null, 401))
      .mockResolvedValueOnce(cookieResponse("A=new"))
      .mockResolvedValueOnce(new Response("new-crumb", { status: 200 }))
      .mockResolvedValueOnce(calendarResponse({ startDate: "2026-10-30" }));
    const provider = new YahooResultProvider(fetchMock);

    await expect(
      provider.getNextResult(asset, "2026-09-08"),
    ).resolves.toMatchObject({
      date: "2026-10-30",
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("contains operational failures and retries them after the short failure TTL", async () => {
    let now = 1_000;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(cookieResponse())
      .mockResolvedValueOnce(new Response("crumb", { status: 200 }))
      .mockResolvedValueOnce(calendarResponse({ startDate: "2026-10-30" }));
    const provider = new YahooResultProvider(fetchMock, () => now);

    await expect(
      provider.getNextResult(asset, "2026-09-08"),
    ).resolves.toBeNull();
    await expect(
      provider.getNextResult(asset, "2026-09-08"),
    ).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();

    now += 30 * 60 * 1_000 + 1;
    await expect(
      provider.getNextResult(asset, "2026-09-08"),
    ).resolves.toMatchObject({
      date: "2026-10-30",
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("reuses one symbol cache entry when the requested day changes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cookieResponse())
      .mockResolvedValueOnce(new Response("crumb", { status: 200 }))
      .mockResolvedValueOnce(calendarResponse({ startDate: "2026-10-30" }));
    const provider = new YahooResultProvider(fetchMock);

    await provider.getNextResult(asset, "2026-09-08");
    await provider.getNextResult(asset, "2026-09-09");

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
