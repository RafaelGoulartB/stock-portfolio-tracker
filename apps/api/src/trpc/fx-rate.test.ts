import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearFxCache } from "../lib/fx";
import { resolvePreviousUsdBrlRate, resolveUsdBrlRate } from "./fx-rate";

function stubFrankfurter(rate: number) {
  return vi.fn<(input: string | URL) => Promise<unknown>>(async () => ({
    ok: true,
    json: async () => ({ date: "2026-09-08", rates: { BRL: rate } }),
  }));
}

describe("resolveUsdBrlRate", () => {
  beforeEach(() => {
    clearFxCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers an explicit rate over any provider", async () => {
    const fetchMock = stubFrankfurter(9.99);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveUsdBrlRate({ usdBrlRate: "5.42", fxSource: "frankfurter" }),
    ).resolves.toBe("5.42");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves from the provider when no rate is supplied", async () => {
    vi.stubGlobal("fetch", stubFrankfurter(5.4321));

    await expect(resolveUsdBrlRate({ fxSource: "frankfurter" })).resolves.toBe(
      "5.43210000",
    );
  });

  it("defaults to Frankfurter when no source is given", async () => {
    vi.stubGlobal("fetch", stubFrankfurter(5.1));

    await expect(resolveUsdBrlRate({})).resolves.toBe("5.10000000");
  });

  it("uses the user's manual rate and contacts no provider", async () => {
    const fetchMock = stubFrankfurter(5.4);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveUsdBrlRate({ fxSource: "manual", manualRate: "6.10" }),
    ).resolves.toBe("6.10");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns undefined for manual mode without a rate", async () => {
    await expect(
      resolveUsdBrlRate({ fxSource: "manual" }),
    ).resolves.toBeUndefined();
  });

  it("returns undefined instead of inventing a rate when the provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(
      resolveUsdBrlRate({ fxSource: "frankfurter" }),
    ).resolves.toBeUndefined();
  });

  it("asks the provider for the snapshot day when one is given", async () => {
    const fetchMock = stubFrankfurter(5.2);
    vi.stubGlobal("fetch", fetchMock);

    await resolveUsdBrlRate({ fxSource: "frankfurter", asOf: "2026-07-31" });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("2026-07-31");
  });
});

describe("resolvePreviousUsdBrlRate", () => {
  beforeEach(() => {
    clearFxCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses the typed rate for a manual source", async () => {
    const fetchMock = stubFrankfurter(5.4);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolvePreviousUsdBrlRate({
        currentRate: "6.10",
        fxSource: "manual",
        previousDay: "2026-09-08",
      }),
    ).resolves.toBe("6.10");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks the provider for the previous weekday", async () => {
    const fetchMock = stubFrankfurter(5.2);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolvePreviousUsdBrlRate({
        currentRate: "5.5",
        fxSource: "frankfurter",
        previousDay: "2026-09-08",
      }),
    ).resolves.toBe("5.20000000");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("2026-09-08");
  });

  it("falls back to the live rate when the dated quote is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    await expect(
      resolvePreviousUsdBrlRate({
        currentRate: "5.5",
        fxSource: "frankfurter",
        previousDay: "2026-09-08",
      }),
    ).resolves.toBe("5.5");
  });
});
