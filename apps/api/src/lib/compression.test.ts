import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { streamingCompress } from "./compression";
import { BACKUP_MEDIA_TYPE } from "./data-backup";

const GZIP = { "Accept-Encoding": "gzip, deflate, br" };

function app() {
  const instance = new Hono();

  instance.use("*", streamingCompress());
  instance.get("/json", (c) =>
    c.json({ positions: Array.from({ length: 200 }, (_, i) => ({ i })) }),
  );
  instance.get("/tiny", () => {
    const body = JSON.stringify({ ok: true });

    return new Response(body, {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      },
    });
  });
  instance.get("/signed-in", (c) => {
    c.header("Set-Cookie", "portifolio_session=abc; Path=/; HttpOnly");
    c.header("Vary", "trpc-accept");

    return c.json({ user: Array.from({ length: 200 }, (_, i) => ({ i })) });
  });
  instance.get(
    "/backup",
    () =>
      new Response(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]), {
        headers: { "Content-Type": BACKUP_MEDIA_TYPE },
      }),
  );
  instance.get("/empty", (c) => c.body(null, 204));

  return instance;
}

async function raw(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

describe("streamingCompress", () => {
  it("compresses JSON and stays decodable", async () => {
    const response = await app().request("/json", { headers: GZIP });
    const body = await raw(response);

    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");
    expect(response.headers.get("Content-Length")).toBeNull();

    const decoded = JSON.parse(gunzipSync(body).toString("utf8")) as {
      positions: { i: number }[];
    };

    expect(decoded.positions).toHaveLength(200);
    expect(body.byteLength).toBeLessThan(
      Buffer.byteLength(JSON.stringify(decoded)) / 2,
    );
  });

  it("leaves the body alone when the client cannot decode gzip", async () => {
    const response = await app().request("/json");

    expect(response.headers.get("Content-Encoding")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      positions: expect.any(Array),
    });
  });

  it("never gzips an already-compressed backup download", async () => {
    const response = await app().request("/backup", { headers: GZIP });

    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect([...(await raw(response))]).toEqual([0x1f, 0x8b, 0x08, 0x00]);
  });

  it("skips payloads that declare a tiny length, and bodiless responses", async () => {
    const tiny = await app().request("/tiny", { headers: GZIP });
    const empty = await app().request("/empty", { headers: GZIP });

    expect(tiny.headers.get("Content-Encoding")).toBeNull();
    expect(empty.headers.get("Content-Encoding")).toBeNull();
    expect(empty.status).toBe(204);
  });

  it("keeps the session cookie and existing Vary values", async () => {
    const response = await app().request("/signed-in", { headers: GZIP });

    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Set-Cookie")).toContain("portifolio_session=");

    const vary = response.headers.get("Vary") ?? "";

    // Hono's `c.res` setter copies the previous headers over the new response,
    // so a naive implementation loses whichever of these was written last.
    expect(vary).toContain("Accept-Encoding");
    expect(vary).toContain("trpc-accept");
  });

  it("delivers an early chunk before the source stream ends", async () => {
    const instance = new Hono();
    let releaseSlowChunk: () => void = () => {};
    const slowChunk = new Promise<void>((resolve) => {
      releaseSlowChunk = resolve;
    });

    instance.use("*", streamingCompress());
    instance.get("/stream", () => {
      const encoder = new TextEncoder();

      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(encoder.encode(`${"fast".repeat(600)}\n`));
            await slowChunk;
            controller.enqueue(encoder.encode(`${"slow".repeat(600)}\n`));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    });

    const response = await instance.request("/stream", { headers: GZIP });
    const reader = response.body?.getReader();

    if (!reader) {
      throw new Error("Expected a streamed body");
    }

    // The first read must resolve while the producer is still blocked, which
    // is exactly what `CompressionStream` would not allow.
    const first = await reader.read();

    expect(first.done).toBe(false);
    expect(first.value?.byteLength).toBeGreaterThan(0);

    releaseSlowChunk();

    let rest = 0;
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      rest += value.byteLength;
    }

    expect(rest).toBeGreaterThan(0);
  });
});
