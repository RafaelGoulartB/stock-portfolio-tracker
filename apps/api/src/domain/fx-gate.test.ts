import { fxQuoteGate } from "@portifolio-tracker/shared";
import { describe, expect, it } from "vitest";

describe("fxQuoteGate", () => {
  it("enables external sources regardless of the manual rate", () => {
    expect(
      fxQuoteGate({ fxSource: "frankfurter", manualRateValid: false }),
    ).toEqual({
      enabled: true,
      manualRateInvalid: false,
    });
  });

  it("disables a manual source until the rate parses", () => {
    expect(fxQuoteGate({ fxSource: "manual", manualRateValid: false })).toEqual(
      {
        enabled: false,
        manualRateInvalid: true,
      },
    );
  });

  it("enables a manual source once the rate parses", () => {
    expect(fxQuoteGate({ fxSource: "manual", manualRateValid: true })).toEqual({
      enabled: true,
      manualRateInvalid: false,
    });
  });
});
