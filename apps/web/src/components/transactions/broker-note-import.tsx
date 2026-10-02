import { msg, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  BROKER_NOTE_ASSET_CLASSES,
  type BrokerNotePreview,
  type BrokerNotePreviewNote,
  type BrokerNoteReadFile,
  b3TickerSchema,
  MAX_BROKER_NOTE_DOCUMENTS,
  MAX_BROKER_NOTE_FILE_BYTES,
  MAX_BROKER_NOTE_FILES,
} from "@portifolio-tracker/shared";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { assetClassText, SideLabel } from "@/components/asset-labels";
import { AssetLink } from "@/components/asset-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/lib/api";
import {
  formatMoney,
  formatPreciseMoney,
  formatQuantity,
  formatTradeDate,
} from "@/lib/format";
import {
  brokerNoteImportErrorMessage,
  brokerNotePreviewErrorMessage,
  brokerNoteReadErrorMessage,
  isBrokerNoteReadingExpired,
} from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";
import {
  BrokerNoteStatusBadge,
  brokerName,
  brokerNoteFileErrorText,
  brokerNoteIssueText,
} from "./broker-note-labels";

/**
 * Bytes sent per read request. Files are read in small batches so a folder
 * of hundreds of notes never becomes one huge upload.
 */
const READ_BATCH_BYTES = 6 * 1024 * 1024;

type FileEntry = {
  key: string;
  name: string;
  size: number;
  /** Kept to read the file again if the server's reading expires. */
  file: File;
  status: "queued" | "reading" | "read" | "failed";
  /** What the server read; `null` until read. */
  result: BrokerNoteReadFile | null;
};

type NoteClass = (typeof BROKER_NOTE_ASSET_CLASSES)[number];

/** Reads a file as base64 without building one huge argument list. */
async function readBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

/** The well-formed mappings of the form, in the order they were entered. */
function mappingList(mappings: Record<string, string>) {
  return Object.entries(mappings)
    .map(([sourceKey, ticker]) => ({
      sourceKey,
      ticker: ticker.trim().toUpperCase(),
    }))
    .filter((mapping) => b3TickerSchema.safeParse(mapping.ticker).success);
}

function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** True when a drag carries files (not text or a link from the page). */
function draggingFiles(event: DragEvent<HTMLElement>): boolean {
  return event.dataTransfer.types.includes("Files");
}

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The next queued files that fit one read request. */
function nextBatch(entries: readonly FileEntry[]): FileEntry[] {
  const batch: FileEntry[] = [];
  let bytes = 0;

  for (const entry of entries) {
    if (entry.status !== "queued") continue;
    if (batch.length >= MAX_BROKER_NOTE_FILES) break;
    if (batch.length > 0 && bytes + entry.size > READ_BATCH_BYTES) break;
    batch.push(entry);
    bytes += entry.size;
  }

  return batch;
}

/**
 * Upload, review and import of broker notes. Files are read by the API in
 * small batches and come back as signed notes; the preview and the import
 * send those notes, not the PDFs, so hundreds of files are uploaded once.
 */
export function BrokerNoteImport({
  onImported,
}: {
  onImported: () => Promise<void>;
}) {
  const { i18n } = useLingui();
  const fileInput = useRef<HTMLInputElement>(null);
  /** Nested drag enter/leave events, so children do not end the hover. */
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  /** Source of truth for the async reading loop, mirrored into state. */
  const entriesRef = useRef<FileEntry[]>([]);
  /** Bumped by Clear so a reading loop in flight stops touching state. */
  const generation = useRef(0);
  const readingLoop = useRef(false);
  const [reading, setReading] = useState(false);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const mappingsRef = useRef(mappings);
  const [classes, setClasses] = useState<Record<string, NoteClass>>({});
  const [preview, setPreview] = useState<BrokerNotePreview | null>(null);
  /** Only the latest preview request may replace the shown preview. */
  const previewSequence = useRef(0);
  /** The mappings the shown preview was computed with. */
  const [previewMappings, setPreviewMappings] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [onlyAttention, setOnlyAttention] = useState(false);

  useEffect(() => {
    mappingsRef.current = mappings;
  }, [mappings]);

  const readMutation = trpc.brokerNotes.read.useMutation({
    onError: (error) =>
      toast.error(brokerNoteReadErrorMessage(error), {
        id: "broker-note-read",
      }),
  });
  const previewMutation = trpc.brokerNotes.preview.useMutation();
  const importMutation = trpc.brokerNotes.import.useMutation();

  const mappingInput = useMemo(() => mappingList(mappings), [mappings]);
  const mappingKey = JSON.stringify(mappingInput);
  const stale = preview !== null && mappingKey !== previewMappings;

  function commit(next: FileEntry[]) {
    entriesRef.current = next;
    setEntries(next);
  }

  /** Reads the server's verdict again; reruns automatically after reading. */
  async function runPreview() {
    const sequence = ++previewSequence.current;
    const documents = entriesRef.current.flatMap((entry) =>
      entry.result?.document ? [entry.result.document] : [],
    );

    if (documents.length === 0) {
      setPreview(null);
      setSelected(new Set());
      return;
    }

    const current = mappingsRef.current;
    let result: BrokerNotePreview;

    try {
      result = await previewMutation.mutateAsync({
        documents,
        mappings: mappingList(current),
      });
    } catch (error) {
      if (isBrokerNoteReadingExpired(error)) {
        rereadAll();
      } else {
        toast.error(brokerNotePreviewErrorMessage(error));
      }
      return;
    }

    if (sequence !== previewSequence.current) return;

    // Saved mappings come back resolved; showing them in the form does not
    // change what the preview was computed with.
    const next = { ...current };
    for (const security of result.securities) {
      if (next[security.sourceKey] === undefined && security.ticker) {
        next[security.sourceKey] = security.ticker;
      }
    }

    setPreview(result);
    setMappings(next);
    setPreviewMappings(JSON.stringify(mappingList(next)));
    setSelected(
      new Set(
        result.notes
          .filter((note) => note.status === "ready")
          .map((note) => note.fingerprint),
      ),
    );
  }

  /** Sends queued files batch by batch, then previews everything read. */
  async function readQueue() {
    if (readingLoop.current) return;

    const run = generation.current;
    readingLoop.current = true;
    setReading(true);

    for (;;) {
      const batch = nextBatch(entriesRef.current);
      if (batch.length === 0) break;

      const keys = new Set(batch.map((entry) => entry.key));
      commit(
        entriesRef.current.map((entry) =>
          keys.has(entry.key) ? { ...entry, status: "reading" } : entry,
        ),
      );

      let results: BrokerNoteReadFile[] | null = null;
      try {
        const files = await Promise.all(
          batch.map(async (entry) => ({
            name: entry.name,
            contentBase64: await readBase64(entry.file),
          })),
        );
        results = await readMutation.mutateAsync({ files });
      } catch {
        results = null;
      }

      if (run !== generation.current) return;

      // The API answers in request order, one result per file.
      commit(
        entriesRef.current.map((entry) => {
          const index = batch.findIndex((item) => item.key === entry.key);
          if (index < 0) return entry;

          const result = results?.[index] ?? null;
          return result
            ? { ...entry, status: "read", result }
            : { ...entry, status: "failed", result: null };
        }),
      );
    }

    readingLoop.current = false;
    setReading(false);
    await runPreview();
  }

  /** The server restarted and its signatures expired: read everything again. */
  function rereadAll() {
    toast.info(
      t({
        id: "brokerNotes.readingExpired",
        message:
          "The reading of these files expired. Reading them again before you continue.",
      }),
    );
    setPreview(null);
    commit(
      entriesRef.current.map((entry) => ({
        ...entry,
        status: "queued",
        result: null,
      })),
    );
    void readQueue();
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;

    const incoming = [...list];
    const rejected = incoming.filter((file) => !isPdfFile(file));

    // A drop bypasses the input's `accept`; only PDFs go to the API.
    if (rejected.length > 0) {
      const names = rejected.map((file) => file.name).join(", ");
      toast.error(
        t({
          id: "brokerNotes.notPdfToast",
          message: `Only PDF files can be imported: ${names}`,
        }),
      );
    }

    const known = new Set(entriesRef.current.map((entry) => entry.key));
    const added: FileEntry[] = [];

    for (const file of incoming.filter(isPdfFile)) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;

      if (known.has(key)) continue;
      known.add(key);

      if (file.size > MAX_BROKER_NOTE_FILE_BYTES) {
        const name = file.name;
        toast.error(
          t({
            id: "brokerNotes.fileTooLargeToast",
            message: `${name} is larger than 5 MB.`,
          }),
        );
        continue;
      }

      added.push({
        key,
        name: file.name,
        size: file.size,
        file,
        status: "queued",
        result: null,
      });
    }

    const room = MAX_BROKER_NOTE_DOCUMENTS - entriesRef.current.length;

    if (added.length > room) {
      const max = MAX_BROKER_NOTE_DOCUMENTS;
      toast.warning(
        t({
          id: "brokerNotes.tooManyFiles",
          message: `Select at most ${max} files at once.`,
        }),
      );
    }

    const accepted = added.slice(0, Math.max(0, room));
    if (accepted.length === 0) return;

    commit([...entriesRef.current, ...accepted]);
    void readQueue();
  }

  function removeFile(key: string) {
    commit(entriesRef.current.filter((entry) => entry.key !== key));
    if (!readingLoop.current) void runPreview();
  }

  function retryFailed() {
    commit(
      entriesRef.current.map((entry) =>
        entry.status === "failed" ? { ...entry, status: "queued" } : entry,
      ),
    );
    void readQueue();
  }

  function reset() {
    generation.current += 1;
    previewSequence.current += 1;
    readingLoop.current = false;
    setReading(false);
    commit([]);
    setPreview(null);
    setSelected(new Set());
    setClasses({});
    setPreviewMappings("");
    setOnlyAttention(false);
  }

  async function importSelected() {
    if (!preview || selected.size === 0 || stale) return;

    const documents = entriesRef.current.flatMap((entry) =>
      entry.result?.document ? [entry.result.document] : [],
    );
    let result: { notes: number; transactions: number };

    try {
      result = await importMutation.mutateAsync({
        documents,
        mappings: mappingInput,
        assetClasses: preview.newTickers.map((entry) => ({
          ticker: entry.ticker,
          assetClass: classes[entry.ticker] ?? entry.assetClass,
        })),
        fingerprints: [...selected],
      });
    } catch (error) {
      if (isBrokerNoteReadingExpired(error)) {
        rereadAll();
      } else {
        toast.error(brokerNoteImportErrorMessage(error));
        await runPreview();
      }
      return;
    }

    const notes = result.notes;
    const trades = result.transactions;
    toast.success(
      t({
        id: "brokerNotes.imported",
        message: plural(
          { count: notes },
          {
            one: `# note imported with ${trades} trades`,
            other: `# notes imported with ${trades} trades`,
          },
        ),
      }),
    );
    reset();
    await onImported();
  }

  const total = entries.length;
  const done = entries.filter(
    (entry) => entry.status === "read" || entry.status === "failed",
  ).length;
  const failed = entries.filter((entry) => entry.status === "failed");
  const fileErrors = entries.flatMap((entry) =>
    entry.result?.error ? [entry.result] : [],
  );
  const unmapped =
    preview?.securities.filter((security) => {
      const value = (mappings[security.sourceKey] ?? "").trim().toUpperCase();
      return !b3TickerSchema.safeParse(value).success;
    }).length ?? 0;
  const busy = reading || previewMutation.isPending || importMutation.isPending;
  const notes = useMemo(
    () =>
      [...(preview?.notes ?? [])].sort(
        (a, b) =>
          a.tradeDate.localeCompare(b.tradeDate) ||
          a.fileName.localeCompare(b.fileName),
      ),
    [preview],
  );
  const counts = {
    ready: notes.filter((note) => note.status === "ready").length,
    blocked: notes.filter((note) => note.status === "blocked").length,
    imported: notes.filter((note) => note.status === "imported").length,
    duplicate: notes.filter((note) => note.status === "duplicate").length,
  };
  const shownNotes = onlyAttention
    ? notes.filter((note) => note.status === "blocked")
    : notes;

  const dropHandlers = {
    onDragEnter(event: DragEvent<HTMLElement>) {
      if (!draggingFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver(event: DragEvent<HTMLElement>) {
      if (!draggingFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = importMutation.isPending
        ? "none"
        : "copy";
    },
    onDragLeave(event: DragEvent<HTMLElement>) {
      if (!draggingFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop(event: DragEvent<HTMLElement>) {
      if (!draggingFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!importMutation.isPending) addFiles(event.dataTransfer.files);
    },
  };

  return (
    <Card {...dropHandlers}>
      <CardHeader>
        <CardTitle>
          <Trans id="brokerNotes.importTitle">Import broker notes</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="brokerNotes.importHint">
            Select the PDF notes from your broker. Each note is checked against
            its own totals before anything is imported, and its trades can only
            be removed by deleting the note.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-primary bg-primary/5" : "bg-muted/30",
          )}
        >
          <Upload
            className={cn(
              "size-6",
              dragging ? "text-primary" : "text-muted-foreground",
            )}
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">
            {dragging ? (
              <Trans id="brokerNotes.dropNow">Drop the PDFs to read them</Trans>
            ) : (
              <Trans id="brokerNotes.dropHint">
                Drag broker note PDFs here, or choose them from your computer.
              </Trans>
            )}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={importMutation.isPending}
              onClick={() => fileInput.current?.click()}
            >
              <Upload className="size-4" aria-hidden="true" />
              <Trans id="brokerNotes.choose">Choose PDFs</Trans>
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="application/pdf,.pdf"
              className="sr-only"
              aria-label={i18n._(
                msg({
                  id: "brokerNotes.chooseLabel",
                  message: "Broker note PDFs",
                }),
              )}
              onChange={(event) => {
                addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {total > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={importMutation.isPending}
                onClick={reset}
              >
                <X className="size-4" aria-hidden="true" />
                <Trans id="brokerNotes.clear">Clear</Trans>
              </Button>
            ) : null}
          </div>
        </div>

        {reading ? (
          <div className="space-y-2" role="status" aria-live="polite">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              <Trans id="brokerNotes.readingProgress">
                Reading {done} of {total} files…
              </Trans>
            </p>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${total ? (done / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : previewMutation.isPending ? (
          <p
            className="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            <Trans id="brokerNotes.checking">
              Checking the notes against your trades…
            </Trans>
          </p>
        ) : null}

        {total > 0 ? (
          <ul className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {entries.map((entry) => {
              const name = entry.name;

              return (
                <li
                  key={entry.key}
                  className={cn(
                    "flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs",
                    (entry.status === "failed" || entry.result?.error) &&
                      "border-loss/40",
                  )}
                >
                  {entry.status === "reading" ? (
                    <Loader2
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                      aria-hidden="true"
                    />
                  ) : entry.status === "failed" || entry.result?.error ? (
                    <TriangleAlert
                      className="size-3.5 shrink-0 text-loss"
                      aria-hidden="true"
                    />
                  ) : (
                    <FileText
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{entry.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatFileSize(entry.size)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={busy}
                    aria-label={t({
                      id: "brokerNotes.removeFile",
                      message: `Remove ${name}`,
                    })}
                    onClick={() => removeFile(entry.key)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {failed.length > 0 && !reading ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-loss/40 px-4 py-3 text-sm"
          >
            <p className="min-w-0 flex-1">
              {t({
                id: "brokerNotes.sendFailed",
                message: plural(
                  { count: failed.length },
                  {
                    one: "# file could not be sent to the server.",
                    other: "# files could not be sent to the server.",
                  },
                ),
              })}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={retryFailed}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              <Trans id="brokerNotes.retryFailed">Try again</Trans>
            </Button>
          </div>
        ) : null}

        {fileErrors.length > 0 ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertTitle>
              <Trans id="brokerNotes.fileErrorsTitle">
                Some files were not read
              </Trans>
            </AlertTitle>
            <AlertDescription>
              <ul className="max-h-60 space-y-1 overflow-y-auto">
                {fileErrors.map((file) =>
                  file.error ? (
                    <li key={`${file.fileName}:${file.sha256}`}>
                      <span className="font-medium">{file.fileName}</span>:{" "}
                      {brokerNoteFileErrorText(file.error, i18n)}
                      {file.errorDetail ? (
                        <span className="block text-xs opacity-80">
                          {file.errorDetail}
                        </span>
                      ) : null}
                    </li>
                  ) : null,
                )}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {preview && preview.securities.length > 0 ? (
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">
                <Trans id="brokerNotes.securitiesTitle">
                  Tickers of B3 notes
                </Trans>
              </h3>
              <p className="text-sm text-muted-foreground">
                <Trans id="brokerNotes.securitiesHint">
                  Inter prints the trading name instead of the ticker. Confirm
                  each ticker once; later notes reuse it.
                </Trans>
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {preview.securities.map((security) => {
                const value = mappings[security.sourceKey] ?? "";
                const valid = b3TickerSchema.safeParse(
                  value.trim().toUpperCase(),
                ).success;
                const inputId = `security-${security.sourceKey}`;

                return (
                  <div
                    key={security.sourceKey}
                    className="flex items-center gap-3 rounded-md border px-3 py-2"
                  >
                    <label
                      htmlFor={inputId}
                      className="min-w-0 flex-1 truncate text-sm"
                      title={security.description}
                    >
                      {security.description}
                      {security.saved && value === security.ticker ? (
                        <span className="block text-xs text-muted-foreground">
                          <Trans id="brokerNotes.savedMapping">
                            Saved from an earlier note
                          </Trans>
                        </span>
                      ) : null}
                    </label>
                    <Input
                      id={inputId}
                      value={value}
                      placeholder="PETR4"
                      autoComplete="off"
                      className="w-28 uppercase"
                      disabled={busy}
                      aria-invalid={value !== "" && !valid}
                      onChange={(event) =>
                        setMappings((current) => ({
                          ...current,
                          [security.sourceKey]: event.target.value,
                        }))
                      }
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {stale ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-caution/40 bg-caution/10 px-4 py-3 text-sm"
          >
            <p className="min-w-0 flex-1">
              <Trans id="brokerNotes.staleHint">
                Tickers changed. Check the notes again before importing.
              </Trans>
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void runPreview()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              <Trans id="brokerNotes.recheck">Check again</Trans>
            </Button>
          </div>
        ) : null}

        {preview && preview.newTickers.length > 0 ? (
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-medium">
                <Trans id="brokerNotes.newTickersTitle">New tickers</Trans>
              </h3>
              <p className="text-sm text-muted-foreground">
                <Trans id="brokerNotes.newTickersHint">
                  These tickers have no trades yet. Confirm their class.
                </Trans>
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {preview.newTickers.map((entry) => {
                const ticker = entry.ticker;

                return (
                  <div
                    key={entry.ticker}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <span className="text-sm font-medium">
                      {entry.ticker}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {entry.currency}
                      </span>
                    </span>
                    <Select
                      value={classes[entry.ticker] ?? entry.assetClass}
                      onValueChange={(value) =>
                        setClasses((current) => ({
                          ...current,
                          [entry.ticker]: value as NoteClass,
                        }))
                      }
                    >
                      <SelectTrigger
                        className="w-40"
                        aria-label={t({
                          id: "brokerNotes.classOf",
                          message: `Class of ${ticker}`,
                        })}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BROKER_NOTE_ASSET_CLASSES.map((assetClass) => (
                          <SelectItem key={assetClass} value={assetClass}>
                            {assetClassText(assetClass, i18n)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {preview && notes.length > 0 ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">
                  <Trans id="brokerNotes.notesTitle">Notes found</Trans>
                </h3>
                <p className="text-sm text-muted-foreground">
                  <Trans id="brokerNotes.noteCounts">
                    {counts.ready} ready · {counts.blocked} need attention ·{" "}
                    {counts.imported} already imported · {counts.duplicate}{" "}
                    repeated
                  </Trans>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch
                    id="broker-notes-attention"
                    checked={onlyAttention}
                    onCheckedChange={setOnlyAttention}
                  />
                  <Label htmlFor="broker-notes-attention" className="text-sm">
                    <Trans id="brokerNotes.onlyAttention">
                      Only notes that need attention
                    </Trans>
                  </Label>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || stale || counts.ready === 0}
                  onClick={() =>
                    setSelected(
                      new Set(
                        notes
                          .filter((note) => note.status === "ready")
                          .map((note) => note.fingerprint),
                      ),
                    )
                  }
                >
                  <Trans id="brokerNotes.selectAllReady">
                    Select all ready
                  </Trans>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || selected.size === 0}
                  onClick={() => setSelected(new Set())}
                >
                  <Trans id="brokerNotes.selectNone">Select none</Trans>
                </Button>
              </div>
            </div>
            <ul className="space-y-2">
              {shownNotes.map((note) => (
                <PreviewNoteRow
                  key={`${note.fileName}:${note.fingerprint}:${note.status}`}
                  note={note}
                  checked={
                    note.status === "ready" && selected.has(note.fingerprint)
                  }
                  disabled={busy || stale || note.status !== "ready"}
                  onCheckedChange={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (checked) next.add(note.fingerprint);
                      else next.delete(note.fingerprint);
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          </section>
        ) : null}

        {preview ? (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            {unmapped > 0 ? (
              <p className="mr-auto text-sm text-muted-foreground">
                {t({
                  id: "brokerNotes.unmappedCount",
                  message: plural(
                    { count: unmapped },
                    {
                      one: "# security still needs a ticker.",
                      other: "# securities still need a ticker.",
                    },
                  ),
                })}
              </p>
            ) : null}
            <Button
              type="button"
              disabled={busy || stale || selected.size === 0}
              onClick={() => void importSelected()}
            >
              {importMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t({
                id: "brokerNotes.importSelected",
                message: plural(
                  { count: selected.size },
                  {
                    one: "Import # note",
                    other: "Import # notes",
                  },
                ),
              })}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PreviewNoteRow({
  note,
  checked,
  disabled,
  onCheckedChange,
}: {
  note: BrokerNotePreviewNote;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(note.status === "blocked");
  const broker = brokerName(note.format);
  const date = formatTradeDate(note.tradeDate);
  const duplicates = note.trades.filter((trade) => trade.possibleDuplicate);
  const checkboxId = `note-${note.fingerprint}-${note.fileName}`;

  return (
    <li className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
        <Checkbox
          id={checkboxId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          aria-label={t({
            id: "brokerNotes.selectNote",
            message: `Import the ${broker} note of ${date}`,
          })}
        />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span>{formatTradeDate(note.tradeDate)}</span>
            <span className="text-muted-foreground">·</span>
            <span>{broker}</span>
            {note.noteNumber ? (
              <span className="text-muted-foreground">
                <Trans id="brokerNotes.noteNumber">No. {note.noteNumber}</Trans>
              </span>
            ) : null}
            <BrokerNoteStatusBadge status={note.status} />
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {note.fileName}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-right text-xs tabular-nums sm:grid-cols-4">
          <dt className="text-muted-foreground">
            <Trans id="brokerNotes.purchases">Purchases</Trans>
          </dt>
          <dd>{formatMoney(note.purchasesTotal, note.currency)}</dd>
          <dt className="text-muted-foreground">
            <Trans id="brokerNotes.sales">Sales</Trans>
          </dt>
          <dd>{formatMoney(note.salesTotal, note.currency)}</dd>
          <dt className="text-muted-foreground">
            <Trans id="brokerNotes.fees">Costs</Trans>
          </dt>
          <dd>{formatMoney(note.feesTotal, note.currency)}</dd>
          <dt className="text-muted-foreground">
            <Trans id="brokerNotes.net">Net</Trans>
          </dt>
          <dd className="font-medium">
            {formatMoney(note.netAmount, note.currency)}
          </dd>
        </dl>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-4" aria-hidden="true" />
          )}
          {t({
            id: "brokerNotes.tradeCount",
            message: plural(
              { count: note.trades.length },
              { one: "# trade", other: "# trades" },
            ),
          })}
        </Button>
      </div>

      {note.issues.length > 0 ? (
        <ul className="space-y-1 border-t px-3 py-2 text-sm text-loss">
          {note.issues.map((issue) => (
            <li key={`${issue.code}:${issue.ticker}:${issue.description}`}>
              {brokerNoteIssueText(issue, i18n)}
            </li>
          ))}
        </ul>
      ) : null}

      {duplicates.length > 0 && note.status === "ready" ? (
        <p className="flex items-start gap-2 border-t px-3 py-2 text-sm">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-caution"
            aria-hidden="true"
          />
          <Trans id="brokerNotes.possibleDuplicates">
            Some trades match trades you registered by hand on the same day.
            Importing them would count them twice; delete the manual ones if
            this note replaces them.
          </Trans>
        </p>
      ) : null}

      {open ? (
        <div className="overflow-x-auto border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Trans id="brokerNotes.colSecurity">Security</Trans>
                </TableHead>
                <TableHead>
                  <Trans id="transactions.colTicker">Ticker</Trans>
                </TableHead>
                <TableHead>
                  <Trans id="transactions.colSide">Side</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="transactions.colQuantity">Quantity</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="transactions.colPrice">Price</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="transactions.colFees">Fees</Trans>
                </TableHead>
                <TableHead className="text-right">
                  <Trans id="transactions.colTotal">Total</Trans>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {note.trades.map((trade, index) => (
                <TableRow
                  // Lines have no id; their position in the note is stable.
                  // biome-ignore lint/suspicious/noArrayIndexKey: document order
                  key={index}
                >
                  <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                    {trade.description}
                    {trade.flags.length > 0 ? (
                      <Badge variant="outline" className="ml-2">
                        {trade.flags.join(" ")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">
                    {trade.ticker ? (
                      <AssetLink ticker={trade.ticker}>
                        {trade.ticker}
                      </AssetLink>
                    ) : (
                      <span className="text-loss">—</span>
                    )}
                    {trade.possibleDuplicate ? (
                      <TriangleAlert
                        className="ml-1 inline size-3.5 text-caution"
                        aria-label={i18n._(
                          msg({
                            id: "brokerNotes.possibleDuplicate",
                            message: "Possible duplicate of a manual trade",
                          }),
                        )}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <SideLabel side={trade.side} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatQuantity(trade.quantity)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPreciseMoney(trade.executionPrice, note.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatPreciseMoney(trade.fees, note.currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(trade.total, note.currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {note.fees.length > 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {note.fees
                .map(
                  (fee) =>
                    `${fee.label}: ${formatMoney(fee.amount, note.currency)}`,
                )
                .join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
