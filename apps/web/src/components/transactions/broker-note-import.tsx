import { msg, plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  BROKER_NOTE_ASSET_CLASSES,
  type BrokerNoteFileError,
  type BrokerNotePreview,
  type BrokerNotePreviewNote,
  b3TickerSchema,
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
import { type DragEvent, useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
} from "@/lib/trpcErrors";
import { cn } from "@/lib/utils";
import {
  BrokerNoteStatusBadge,
  brokerName,
  brokerNoteFileErrorText,
  brokerNoteIssueText,
} from "./broker-note-labels";

type SelectedFile = {
  key: string;
  name: string;
  size: number;
  contentBase64: string;
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

/**
 * Upload, review and import of broker notes. The API reads the PDFs; this
 * screen only collects ticker mappings, classes for new tickers and the
 * notes to import, then sends the same files again to import them.
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
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [classes, setClasses] = useState<Record<string, NoteClass>>({});
  const [preview, setPreview] = useState<BrokerNotePreview | null>(null);
  /** The mappings the shown preview was computed with. */
  const [previewMappings, setPreviewMappings] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const previewMutation = trpc.brokerNotes.preview.useMutation({
    onError: (error) => toast.error(brokerNotePreviewErrorMessage(error)),
  });
  const importMutation = trpc.brokerNotes.import.useMutation({
    onError: (error) => toast.error(brokerNoteImportErrorMessage(error)),
  });

  const mappingInput = useMemo(() => mappingList(mappings), [mappings]);
  const mappingKey = JSON.stringify(mappingInput);
  const stale = preview !== null && mappingKey !== previewMappings;

  async function runPreview(nextFiles: SelectedFile[]) {
    if (nextFiles.length === 0) {
      setPreview(null);
      setSelected(new Set());
      return;
    }

    const result = await previewMutation
      .mutateAsync({
        files: nextFiles.map(({ name, contentBase64 }) => ({
          name,
          contentBase64,
        })),
        mappings: mappingInput,
      })
      .catch(() => null);

    if (!result) return;

    // Saved mappings come back resolved; showing them in the form does not
    // change what the preview was computed with.
    const next = { ...mappings };
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

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;

    const incoming = [...list];
    const accepted: SelectedFile[] = [];
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

    for (const file of incoming.filter(isPdfFile)) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;

      if (files.some((existing) => existing.key === key)) continue;
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

      accepted.push({
        key,
        name: file.name,
        size: file.size,
        contentBase64: await readBase64(file),
      });
    }

    const next = [...files, ...accepted].slice(0, MAX_BROKER_NOTE_FILES);

    if (files.length + accepted.length > MAX_BROKER_NOTE_FILES) {
      const max = MAX_BROKER_NOTE_FILES;
      toast.warning(
        t({
          id: "brokerNotes.tooManyFiles",
          message: `Select at most ${max} files at once.`,
        }),
      );
    }

    setFiles(next);
    await runPreview(next);
  }

  async function removeFile(key: string) {
    const next = files.filter((file) => file.key !== key);
    setFiles(next);
    await runPreview(next);
  }

  function reset() {
    setFiles([]);
    setPreview(null);
    setSelected(new Set());
    setClasses({});
    setPreviewMappings("");
  }

  async function importSelected() {
    if (!preview || selected.size === 0 || stale) return;

    const result = await importMutation
      .mutateAsync({
        files: files.map(({ name, contentBase64 }) => ({
          name,
          contentBase64,
        })),
        mappings: mappingInput,
        assetClasses: preview.newTickers.map((entry) => ({
          ticker: entry.ticker,
          assetClass: classes[entry.ticker] ?? entry.assetClass,
        })),
        fingerprints: [...selected],
      })
      .catch(() => null);

    if (!result) {
      await runPreview(files);
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

  const fileErrors = preview?.files.filter((file) => file.error !== null) ?? [];
  const unmapped =
    preview?.securities.filter((security) => {
      const value = (mappings[security.sourceKey] ?? "").trim().toUpperCase();
      return !b3TickerSchema.safeParse(value).success;
    }).length ?? 0;
  const busy = previewMutation.isPending || importMutation.isPending;

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
      event.dataTransfer.dropEffect = busy ? "none" : "copy";
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
      if (!busy) void addFiles(event.dataTransfer.files);
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
              disabled={busy}
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
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            {files.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={reset}
              >
                <X className="size-4" aria-hidden="true" />
                <Trans id="brokerNotes.clear">Clear</Trans>
              </Button>
            ) : null}
            {previewMutation.isPending ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                <Trans id="brokerNotes.reading">Reading notes…</Trans>
              </span>
            ) : null}
          </div>
        </div>

        {files.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-live="polite">
            {files.map((file) => {
              const name = file.name;
              const result = preview?.files.find(
                (entry) => entry.fileName === file.name,
              );

              return (
                <li
                  key={file.key}
                  className={cn(
                    "flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-xs",
                    result?.error && "border-loss/40",
                  )}
                >
                  <FileText
                    className="size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="truncate">{file.name}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatFileSize(file.size)}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={busy}
                    aria-label={t({
                      id: "brokerNotes.removeFile",
                      message: `Remove ${name}`,
                    })}
                    onClick={() => void removeFile(file.key)}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
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
              <ul className="space-y-1">
                {fileErrors.map((file) => (
                  <li key={`${file.fileName}:${file.sha256}`}>
                    <span className="font-medium">{file.fileName}</span>:{" "}
                    {brokerNoteFileErrorText(
                      file.error as BrokerNoteFileError,
                      i18n,
                    )}
                    {file.errorDetail ? (
                      <span className="block text-xs opacity-80">
                        {file.errorDetail}
                      </span>
                    ) : null}
                  </li>
                ))}
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
              onClick={() => void runPreview(files)}
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

        {preview && preview.notes.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-sm font-medium">
              <Trans id="brokerNotes.notesTitle">Notes found</Trans>
            </h3>
            <ul className="space-y-2">
              {preview.notes.map((note) => (
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
