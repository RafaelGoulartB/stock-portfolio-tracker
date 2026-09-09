import { describe, expect, it } from "vitest";
import { memoizeRequest, runWithRequestMemo } from "./request-memo";

describe("memoizeRequest", () => {
  it("shares one in-flight loader for the same key inside a request", async () => {
    let calls = 0;

    await runWithRequestMemo(async () => {
      const load = () =>
        memoizeRequest("ledger", async () => {
          calls += 1;
          return "ok";
        });

      const [first, second] = await Promise.all([load(), load()]);

      expect(first).toBe("ok");
      expect(second).toBe("ok");
      expect(calls).toBe(1);
    });
  });

  it("does not share work across request boundaries", async () => {
    let calls = 0;
    const load = () =>
      memoizeRequest("ledger", async () => {
        calls += 1;
        return calls;
      });

    await runWithRequestMemo(load);
    await runWithRequestMemo(load);

    expect(calls).toBe(2);
  });
});
