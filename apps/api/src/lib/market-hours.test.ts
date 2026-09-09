import { describe, expect, it } from "vitest";
import { spotTtlMs } from "./market-hours";

const FIFTEEN_MIN = 15 * 60 * 1_000;

describe("spotTtlMs", () => {
  it("keeps the delayed-tape window while B3 is open", () => {
    expect(
      spotTtlMs("stock_br", "BRL", new Date("2026-09-08T14:00:00-03:00")),
    ).toBe(FIFTEEN_MIN);
  });

  it("holds a B3 quote until the next session instead of refetching overnight", () => {
    const ttl = spotTtlMs(
      "stock_br",
      "BRL",
      new Date("2026-09-08T20:00:00-03:00"),
    );

    expect(ttl).toBeGreaterThan(FIFTEEN_MIN);
    expect(ttl).toBeGreaterThan(10 * 60 * 60 * 1_000);
  });

  it("keeps crypto on the short delayed-tape window overnight", () => {
    expect(
      spotTtlMs("crypto", "USD", new Date("2026-09-08T23:00:00-03:00")),
    ).toBe(FIFTEEN_MIN);
  });

  it("uses absolute instants across the US spring DST weekend", () => {
    expect(
      spotTtlMs("stock_us", "USD", new Date("2026-03-06T16:00:00-05:00")),
    ).toBe(64.5 * 60 * 60 * 1_000);
  });

  it("uses absolute instants across the US fall DST weekend", () => {
    expect(
      spotTtlMs("stock_us", "USD", new Date("2026-10-30T16:00:00-04:00")),
    ).toBe(66.5 * 60 * 60 * 1_000);
  });
});
