import { Readable } from "node:stream";
import { constants, createGzip } from "node:zlib";
import type { MiddlewareHandler } from "hono";

/**
 * Response bodies worth compressing. Everything else (already-compressed
 * backups, images, binary downloads) is passed through untouched so a stored
 * archive is never gzipped twice.
 */
const COMPRESSIBLE_TYPE =
  /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/;

/** Below this, framing and the gzip header cost more than they save. */
const MIN_COMPRESSED_BYTES = 1_024;

const SKIPPED_STATUS = new Set([204, 205, 304]);

/**
 * gzip that flushes on every write, so a streamed tRPC batch still delivers
 * each procedure result as it resolves.
 *
 * `hono/compress` uses `CompressionStream`, which withholds output until the
 * source stream ends: with a streaming link the first (fast) result would only
 * reach the browser once the slowest procedure in the batch finished.
 * `Z_SYNC_FLUSH` avoids that and measured within about one percent of the
 * default ratio on portfolio JSON.
 */
export function streamingCompress(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const body = c.res.body;

    if (
      !body ||
      c.req.method === "HEAD" ||
      SKIPPED_STATUS.has(c.res.status) ||
      c.res.headers.has("Content-Encoding")
    ) {
      return;
    }

    if (
      !(c.req.header("Accept-Encoding") ?? "").toLowerCase().includes("gzip")
    ) {
      // Still declare the negotiation so a shared cache keeps variants apart.
      c.res.headers.append("Vary", "Accept-Encoding");
      return;
    }

    const contentType = c.res.headers.get("Content-Type") ?? "";

    if (!COMPRESSIBLE_TYPE.test(contentType)) {
      return;
    }

    const declaredLength = Number(c.res.headers.get("Content-Length"));

    if (
      Number.isFinite(declaredLength) &&
      declaredLength > 0 &&
      declaredLength < MIN_COMPRESSED_BYTES
    ) {
      return;
    }

    const gzip = createGzip({ flush: constants.Z_SYNC_FLUSH, level: 6 });
    const compressed = Readable.toWeb(
      Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]).pipe(
        gzip,
      ),
    ) as ReadableStream<Uint8Array>;

    // Assigning `c.res` makes Hono copy the previous response's headers onto
    // the new one with `set`, so the negotiation headers have to be written on
    // the original response first or they would be overwritten.
    c.res.headers.set("Content-Encoding", "gzip");
    c.res.headers.append("Vary", "Accept-Encoding");
    // The compressed length is unknown until the stream ends.
    c.res.headers.delete("Content-Length");

    c.res = new Response(compressed, {
      status: c.res.status,
      headers: c.res.headers,
    });
  };
}
