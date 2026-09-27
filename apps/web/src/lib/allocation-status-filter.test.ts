import { describe, expect, it } from "vitest";
import { matchesStatus } from "./allocation-status-filter";

describe("allocation status filter", () => {
  it("includes assets with a defined target in Held, including zero targets", () => {
    expect(matchesStatus({ category: "all", status: "invested" }, "0.25")).toBe(
      true,
    );
    expect(matchesStatus({ category: "all", status: "invested" }, "0")).toBe(
      true,
    );
    expect(matchesStatus({ category: "all", status: "invested" }, null)).toBe(
      false,
    );
  });

  it("includes only assets without a target on radar", () => {
    expect(matchesStatus({ category: "all", status: "radar" }, null)).toBe(
      true,
    );
    expect(matchesStatus({ category: "all", status: "radar" }, "0.25")).toBe(
      false,
    );
    expect(matchesStatus({ category: "all", status: "radar" }, "0")).toBe(
      false,
    );
  });

  it("includes every asset when the status filter is Any", () => {
    expect(matchesStatus({ category: "all", status: "any" }, null)).toBe(true);
    expect(matchesStatus({ category: "all", status: "any" }, "0.25")).toBe(
      true,
    );
  });
});
