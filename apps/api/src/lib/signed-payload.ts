import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signs values the API hands to the browser and later accepts back, so the
 * browser can hold them without being able to alter them.
 *
 * The key lives only in this process: a restart invalidates every signature,
 * which merely asks the user to read the files again. Nothing is persisted.
 */
const KEY = randomBytes(32);

/** JSON with object keys sorted, so equal values always sign equally. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

/** HMAC-SHA256 of `value` bound to `scope` (e.g. the account it is for). */
export function signPayload(scope: string, value: unknown): string {
  return createHmac("sha256", KEY)
    .update(`${scope}\n${canonicalJson(value)}`)
    .digest("base64url");
}

export function verifyPayload(
  scope: string,
  value: unknown,
  signature: string,
): boolean {
  const expected = Buffer.from(signPayload(scope, value));
  const given = Buffer.from(signature);

  return expected.length === given.length && timingSafeEqual(expected, given);
}
