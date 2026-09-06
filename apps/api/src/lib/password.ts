import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derive = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

/** `scrypt$N$r$p$salt$key`, all binary parts base64. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH,
    PARAMS,
  );

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const [, n, r, p, salt, key] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(key, "base64");
  const actual = await derive(
    password.normalize("NFKC"),
    Buffer.from(salt, "base64"),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem },
  );

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
