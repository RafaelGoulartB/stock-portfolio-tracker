import { describe, expect, it } from "vitest";
import { resolveSessionCookieSecure } from "./env";

describe("session cookie security", () => {
  it("defaults to secure cookies in production", () => {
    expect(resolveSessionCookieSecure("production", undefined)).toBe(true);
  });

  it("allows loopback-only HTTP production to opt out explicitly", () => {
    expect(resolveSessionCookieSecure("production", false)).toBe(false);
  });

  it("keeps development cookies compatible with HTTP by default", () => {
    expect(resolveSessionCookieSecure("development", undefined)).toBe(false);
  });
});
