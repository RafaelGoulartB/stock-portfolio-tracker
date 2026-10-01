/**
 * Positioned text of a PDF, grouped into visual lines.
 *
 * Coordinates are in the page viewport (top-left origin, rotation applied),
 * so a landscape page reads left to right like on screen. Parsers rely on
 * the x position to tell table columns apart.
 */

export type PdfTextItem = {
  x: number;
  y: number;
  width: number;
  text: string;
};

export type PdfTextLine = {
  y: number;
  /** Items sorted by `x`. */
  items: PdfTextItem[];
  /** Items joined with two spaces, so column boundaries stay visible. */
  text: string;
};

export type PdfPage = {
  number: number;
  lines: PdfTextLine[];
};

export class PdfReadError extends Error {
  constructor(
    readonly reason: "password_protected" | "unreadable" | "too_many_pages",
    message: string,
  ) {
    super(message);
    this.name = "PdfReadError";
  }
}

/** Items whose baselines differ by at most this many points share a line. */
const LINE_TOLERANCE = 2;

export function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/** Groups positioned items into lines, top to bottom. */
export function groupLines(items: readonly PdfTextItem[]): PdfTextLine[] {
  const sorted = items
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({ ...item, text: item.text.trim() }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PdfTextLine[] = [];

  for (const item of sorted) {
    const last = lines.at(-1);

    if (last && Math.abs(last.y - item.y) <= LINE_TOLERANCE) {
      last.items.push(item);
    } else {
      lines.push({ y: item.y, items: [item], text: "" });
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x);
    line.text = line.items.map((item) => item.text).join("  ");
  }

  return lines;
}

/**
 * Reads every page of an untrusted PDF. PDF.js fetches nothing and loads no
 * fonts into the process; the page count is bounded.
 */
export async function extractPdfPages(
  bytes: Uint8Array,
  { maxPages }: { maxPages: number },
): Promise<PdfPage[]> {
  // PDF.js is large and only needed on demand; keep it out of API startup.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    // PDF.js may transfer the buffer it receives; keep the caller's intact.
    data: new Uint8Array(bytes),
    useSystemFonts: true,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  });

  try {
    let pdf: Awaited<typeof loadingTask.promise>;

    try {
      pdf = await loadingTask.promise;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";

      if (name === "PasswordException") {
        throw new PdfReadError(
          "password_protected",
          "The PDF is password-protected",
        );
      }

      throw new PdfReadError(
        "unreadable",
        error instanceof Error ? error.message : "The PDF could not be read",
      );
    }

    if (pdf.numPages > maxPages) {
      throw new PdfReadError(
        "too_many_pages",
        `The PDF has ${pdf.numPages} pages; at most ${maxPages} are read`,
      );
    }

    const pages: PdfPage[] = [];

    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];

      for (const item of content.items) {
        if (!("str" in item)) continue;

        const [x, y] = viewport.convertToViewportPoint(
          item.transform[4],
          item.transform[5],
        ) as [number, number];

        items.push({ x, y, width: item.width, text: item.str });
      }

      pages.push({ number, lines: groupLines(items) });
      page.cleanup();
    }

    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
