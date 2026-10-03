import { describe, expect, it } from "vitest";
import { canonicalJson, signPayload, verifyPayload } from "./signed-payload";

describe("signed payloads", () => {
  it("ignores key order but not values", () => {
    expect(canonicalJson({ b: 1, a: [{ d: "x", c: null }] })).toBe(
      '{"a":[{"c":null,"d":"x"}],"b":1}',
    );

    const signature = signPayload("user-1", { a: "1.00", b: ["2"] });

    expect(verifyPayload("user-1", { b: ["2"], a: "1.00" }, signature)).toBe(
      true,
    );
    expect(verifyPayload("user-1", { a: "1.01", b: ["2"] }, signature)).toBe(
      false,
    );
  });

  it("binds a signature to its scope", () => {
    const signature = signPayload("user-1", { a: 1 });

    expect(verifyPayload("user-2", { a: 1 }, signature)).toBe(false);
    expect(verifyPayload("user-1", { a: 1 }, "short")).toBe(false);
  });
});
