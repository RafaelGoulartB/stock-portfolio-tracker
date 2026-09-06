import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
  ASSET_CLASS_LABELS,
  ASSET_CLASSES,
  type AssetClass,
  type BookHoldingRow,
  bookHoldingRowSchema,
  CURRENCIES,
  CURRENCY_LABELS,
  type Currency,
  parseBrazilianNumber,
  parseHoldingsImport,
  tickerSchema,
} from "@portifolio-tracker/shared";
import { FileUp, Plus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTitleIcon,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";

export type DraftHolding = {
  key: string;
  ticker: string;
  quantity: string;
  price: string;
  assetClass: AssetClass;
  currency: Currency;
};

let draftKey = 0;

export function emptyDraft(
  defaults?: Partial<Omit<DraftHolding, "key">>,
): DraftHolding {
  draftKey += 1;

  return {
    key: `holding-${draftKey}`,
    ticker: "",
    quantity: "",
    price: "",
    assetClass: "stock_br",
    currency: "BRL",
    ...defaults,
  };
}

export function draftsFromParsed(
  rows: ReturnType<typeof parseHoldingsImport>["rows"],
): DraftHolding[] {
  return rows.map((row) =>
    emptyDraft({
      ticker: row.ticker,
      quantity: row.quantity,
      price: row.price,
      assetClass: row.assetClass,
      currency: row.currency,
    }),
  );
}

/** Builds API rows from the spreadsheet; returns null and toasts on failure. */
export function validateDrafts(
  drafts: DraftHolding[],
  i18n: I18n,
): BookHoldingRow[] | null {
  const filled = drafts.filter(
    (row) => row.ticker.trim() || row.quantity.trim() || row.price.trim(),
  );

  if (filled.length === 0) {
    toast.error(
      i18n._(
        t({
          id: "transactions.bookEmpty",
          message: "Add at least one holding with ticker, quantity and price.",
        }),
      ),
    );

    return null;
  }

  const holdings: BookHoldingRow[] = [];
  const seen = new Set<string>();

  for (const row of filled) {
    const ticker = tickerSchema.safeParse(row.ticker);

    if (!ticker.success) {
      toast.error(
        i18n._(
          t({
            id: "transactions.bookTickerInvalid",
            message: `Invalid ticker “${row.ticker || "?"}”.`,
          }),
        ),
      );

      return null;
    }

    const quantity = parseBrazilianNumber(row.quantity);
    const price = parseBrazilianNumber(row.price);

    if (quantity === null || price === null) {
      toast.error(
        i18n._(
          t({
            id: "transactions.bookNumbersInvalid",
            message: `Check quantity and average price for ${ticker.data}.`,
          }),
        ),
      );

      return null;
    }

    if (seen.has(ticker.data)) {
      toast.error(
        i18n._(
          t({
            id: "transactions.bookDuplicate",
            message: `Ticker ${ticker.data} appears more than once.`,
          }),
        ),
      );

      return null;
    }

    seen.add(ticker.data);

    const parsed = bookHoldingRowSchema.safeParse({
      ticker: ticker.data,
      assetClass: row.assetClass,
      currency: row.currency,
      quantity,
      price,
    });

    if (!parsed.success) {
      toast.error(
        i18n._(
          t({
            id: "transactions.bookRowInvalid",
            message: `Could not book ${ticker.data}. Check the numbers.`,
          }),
        ),
      );

      return null;
    }

    holdings.push(parsed.data);
  }

  return holdings;
}

export function ImportHoldingsDialog({
  onImport,
}: {
  onImport: (rows: DraftHolding[]) => void;
}) {
  const { i18n } = useLingui();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<DraftHolding[]>([]);
  const [issues, setIssues] = useState<
    ReturnType<typeof parseHoldingsImport>["issues"]
  >([]);

  function reset() {
    setText("");
    setPreview([]);
    setIssues([]);

    if (fileRef.current) {
      fileRef.current.value = "";
    }
  }

  function applyParse(source: string) {
    const result = parseHoldingsImport(source);
    setIssues(result.issues);
    setPreview(draftsFromParsed(result.rows));

    if (result.rows.length === 0 && result.issues.length === 0) {
      toast.error(
        i18n._(
          t({
            id: "transactions.importEmpty",
            message: "No holdings found in that text.",
          }),
        ),
      );
    }
  }

  function updatePreview(key: string, patch: Partial<DraftHolding>) {
    setPreview((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Upload aria-hidden="true" />
          <Trans id="transactions.import">Import</Trans>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] min-h-0 flex-col gap-5 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <DialogTitleIcon>
              <Upload aria-hidden="true" />
            </DialogTitleIcon>
            <Trans id="transactions.importTitle">Import holdings</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans id="transactions.importDescription">
              Paste a CSV/TXT or choose a file. Expected columns: ticker,
              quantity, average price (e.g. R$ 43,40).
            </Trans>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-2">
            <Label htmlFor="holdings-import-text">
              <Trans id="transactions.importPaste">Paste</Trans>
            </Label>
            <Textarea
              id="holdings-import-text"
              value={text}
              rows={6}
              className="font-mono text-xs"
              placeholder={`Ativo,Qtd,"Preço médio"\nPRIO3,300,"R$ 43,40"\nITUB3,350,"R$ 31,95"`}
              onChange={(event) => setText(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => applyParse(text)}
              disabled={text.trim().length === 0}
            >
              <Trans id="transactions.importParse">Parse text</Trans>
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];

                if (!file) {
                  return;
                }

                const body = await file.text();
                setText(body);
                applyParse(body);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp aria-hidden="true" />
              <Trans id="transactions.importFile">Choose file</Trans>
            </Button>
          </div>

          {issues.length > 0 ? (
            <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {issues.slice(0, 8).map((issue) => {
                const line = issue.line;
                const detail = issue.message;

                return (
                  <li key={`${line}-${detail}`}>
                    {i18n._(
                      t({
                        id: "transactions.importIssue",
                        message: `Line ${line}: ${detail}`,
                      }),
                    )}
                  </li>
                );
              })}
              {issues.length > 8
                ? (() => {
                    const extra = issues.length - 8;

                    return (
                      <li>
                        {i18n._(
                          t({
                            id: "transactions.importIssueMore",
                            message: `And ${extra} more…`,
                          }),
                        )}
                      </li>
                    );
                  })()
                : null}
            </ul>
          ) : null}

          {preview.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Trans id="transactions.ticker">Ticker</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="transactions.quantity">Quantity</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="transactions.avgPrice">Avg price</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="transactions.class">Class</Trans>
                    </TableHead>
                    <TableHead>
                      <Trans id="transactions.currency">Currency</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">
                        {row.ticker}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.quantity}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.price}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.assetClass}
                          onValueChange={(value) =>
                            updatePreview(row.key, {
                              assetClass: value as AssetClass,
                              currency:
                                value === "stock_us"
                                  ? "USD"
                                  : value === "stock_br"
                                    ? "BRL"
                                    : row.currency,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSET_CLASSES.map((value) => (
                              <SelectItem key={value} value={value}>
                                {ASSET_CLASS_LABELS[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.currency}
                          onValueChange={(value) =>
                            updatePreview(row.key, {
                              currency: value as Currency,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-28">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CURRENCIES.map((value) => (
                              <SelectItem key={value} value={value}>
                                {CURRENCY_LABELS[value]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
          >
            <Trans id="transactions.importCancel">Cancel</Trans>
          </Button>
          <Button
            type="button"
            disabled={preview.length === 0}
            onClick={() => {
              onImport(preview);
              setOpen(false);
              reset();
              toast.success(
                i18n._(
                  t({
                    id: "transactions.importMerged",
                    message: `${preview.length} holdings added to the list`,
                  }),
                ),
              );
            }}
          >
            <Trans id="transactions.importConfirm">Add to list</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BookHoldingsPanel({
  tradedAt,
  onTradedAtChange,
  saving,
  onSubmit,
}: {
  tradedAt: string;
  onTradedAtChange: (value: string) => void;
  saving: boolean;
  onSubmit: (holdings: BookHoldingRow[], tradedAt: string) => void;
}) {
  const { i18n } = useLingui();
  const [rows, setRows] = useState<DraftHolding[]>(() => [
    emptyDraft(),
    emptyDraft(),
    emptyDraft(),
  ]);

  function updateRow(key: string, patch: Partial<DraftHolding>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function removeRow(key: string) {
    setRows((current) => {
      const next = current.filter((row) => row.key !== key);

      return next.length > 0 ? next : [emptyDraft()];
    });
  }

  function mergeImported(imported: DraftHolding[]) {
    setRows((current) => {
      const byTicker = new Map<string, DraftHolding>();

      for (const row of current) {
        const ticker = row.ticker.trim().toUpperCase();

        if (ticker) {
          byTicker.set(ticker, { ...row, ticker });
        }
      }

      for (const row of imported) {
        byTicker.set(row.ticker, row);
      }

      return [...byTicker.values(), emptyDraft()];
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="book-holdings-date">
            <Trans id="transactions.openingDate">Opening date</Trans>
          </Label>
          <Input
            id="book-holdings-date"
            type="date"
            value={tradedAt}
            className="w-44"
            onChange={(event) => onTradedAtChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            <Trans id="transactions.openingDateHint">
              Every row is booked as a buy on this date.
            </Trans>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <ImportHoldingsDialog onImport={mergeImported} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRows((current) => [...current, emptyDraft()])}
          >
            <Plus aria-hidden="true" />
            <Trans id="transactions.addRow">Add row</Trans>
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-28">
                <Trans id="transactions.ticker">Ticker</Trans>
              </TableHead>
              <TableHead className="min-w-24">
                <Trans id="transactions.quantity">Quantity</Trans>
              </TableHead>
              <TableHead className="min-w-28">
                <Trans id="transactions.avgPrice">Avg price</Trans>
              </TableHead>
              <TableHead className="min-w-36">
                <Trans id="transactions.class">Class</Trans>
              </TableHead>
              <TableHead className="min-w-28">
                <Trans id="transactions.currency">Currency</Trans>
              </TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, index) => (
              <TableRow key={row.key}>
                <TableCell>
                  <Input
                    value={row.ticker}
                    autoComplete="off"
                    className="h-8 uppercase"
                    placeholder="PETR4"
                    aria-label={i18n._(
                      t({
                        id: "transactions.bookTickerAria",
                        message: `Ticker row ${index + 1}`,
                      }),
                    )}
                    onChange={(event) =>
                      updateRow(row.key, {
                        ticker: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={row.quantity}
                    inputMode="decimal"
                    className="h-8"
                    placeholder="100"
                    aria-label={i18n._(
                      t({
                        id: "transactions.bookQtyAria",
                        message: `Quantity row ${index + 1}`,
                      }),
                    )}
                    onChange={(event) =>
                      updateRow(row.key, { quantity: event.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={row.price}
                    inputMode="decimal"
                    className="h-8"
                    placeholder="32,15"
                    aria-label={i18n._(
                      t({
                        id: "transactions.bookPriceAria",
                        message: `Average price row ${index + 1}`,
                      }),
                    )}
                    onChange={(event) =>
                      updateRow(row.key, { price: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (
                        event.key === "Enter" &&
                        index === rows.length - 1 &&
                        row.ticker.trim()
                      ) {
                        event.preventDefault();
                        setRows((current) => [...current, emptyDraft()]);
                      }
                    }}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={row.assetClass}
                    onValueChange={(value) =>
                      updateRow(row.key, {
                        assetClass: value as AssetClass,
                        ...(value === "stock_us"
                          ? { currency: "USD" as const }
                          : value === "stock_br"
                            ? { currency: "BRL" as const }
                            : {}),
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ASSET_CLASSES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {ASSET_CLASS_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={row.currency}
                    onValueChange={(value) =>
                      updateRow(row.key, { currency: value as Currency })
                    }
                  >
                    <SelectTrigger className="h-8 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {CURRENCY_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={i18n._(
                      t({
                        id: "transactions.bookRemoveRow",
                        message: `Remove row ${index + 1}`,
                      }),
                    )}
                    onClick={() => removeRow(row.key)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Button
        type="button"
        className="w-full sm:w-auto"
        disabled={saving}
        onClick={() => {
          const holdings = validateDrafts(rows, i18n);

          if (!holdings) {
            return;
          }

          onSubmit(holdings, tradedAt);
        }}
      >
        <Trans id="transactions.bookRegister">Book holdings</Trans>
      </Button>
    </div>
  );
}
