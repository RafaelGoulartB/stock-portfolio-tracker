import { describe, expect, it, vi } from "vitest";
import { YahooSession } from "./yahoo-session";

function stubHandshake() {
  let crumbs = 0;
  return vi.fn<typeof fetch>(async (input) => {
    if (String(input).startsWith("https://fc.yahoo.com")) {
      return new Response("", {
        status: 404,
        headers: { "set-cookie": "A=session; Path=/; Secure" },
      });
    }
    crumbs += 1;
    return new Response(`crumb-${crumbs}`, { status: 200 });
  });
}

describe("YahooSession", () => {
  it("shares one handshake between concurrent callers", async () => {
    const fetchMock = stubHandshake();
    const session = new YahooSession(fetchMock);

    const [first, second] = await Promise.all([session.get(), session.get()]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a late refusal of credentials that were already renewed", async () => {
    const fetchMock = stubHandshake();
    const session = new YahooSession(fetchMock);

    const refused = await session.get();
    session.invalidate(refused);
    const renewed = await session.get();
    expect(renewed.crumb).toBe("crumb-2");

    // A second request that was refused with the old pair reports it late.
    session.invalidate(refused);

    await expect(session.get()).resolves.toBe(renewed);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
