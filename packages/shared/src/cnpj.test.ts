import { describe, expect, it } from "vitest";
import { normalizeCnpj } from "./cnpj";

describe("normalizeCnpj", () => {
  it("accepts valid numeric CNPJs with or without punctuation", () => {
    expect(normalizeCnpj("18.945.670/0001-46")).toBe("18.945.670/0001-46");
    expect(normalizeCnpj("94813102000170")).toBe("94.813.102/0001-70");
    // Banco do Brasil's real CNPJ starts with zeros.
    expect(normalizeCnpj("00.000.000/0001-91")).toBe("00.000.000/0001-91");
  });

  it("accepts the alphanumeric format from July 2026", () => {
    expect(normalizeCnpj("12.abc.345/01de-35")).toBe("12.ABC.345/01DE-35");
  });

  it("rejects wrong check digits, sizes and repeated characters", () => {
    expect(normalizeCnpj("18.945.670/0001-47")).toBeNull();
    expect(normalizeCnpj("1894567000014")).toBeNull();
    expect(normalizeCnpj("11.111.111/1111-11")).toBeNull();
    expect(normalizeCnpj("12.ABC.345/01DE-3X")).toBeNull();
  });
});
