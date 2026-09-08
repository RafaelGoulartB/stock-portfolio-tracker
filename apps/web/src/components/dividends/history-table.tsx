import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { AssetLink } from "@/components/asset-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { i18n } from "@/i18n";
import { formatMoney, formatQuantity, formatTradeDate } from "@/lib/format";
import { StatusBadge } from "./badges";
import type { DividendData } from "./types";

export function HistoryTable({ data }: { data: DividendData }) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const pageCount = Math.max(1, Math.ceil(data.events.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const firstRow = safePage * pageSize;
  const visibleEvents = data.events.slice(firstRow, firstRow + pageSize);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount - 1));
  }, [pageCount]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans id="dividends.historyTitle">Income history</Trans>
        </CardTitle>
        <CardDescription>
          <Trans id="dividends.historyDescription">
            Gross estimates. Confirm net credits against your broker statement.
          </Trans>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticker</TableHead>
              <TableHead>
                <Trans id="dividends.exDate">Ex-date</Trans>
              </TableHead>
              <TableHead>
                <Trans id="dividends.payment">Payment</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="dividends.shares">Shares</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="dividends.perShare">Per share</Trans>
              </TableHead>
              <TableHead className="text-right">
                <Trans id="dividends.estimated">Estimated</Trans>
              </TableHead>
              <TableHead>
                <Trans id="dividends.status">Status</Trans>
              </TableHead>
              <TableHead>
                <Trans id="dividends.source">Source</Trans>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleEvents.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">
                  <AssetLink ticker={event.ticker}>{event.ticker}</AssetLink>
                </TableCell>
                <TableCell>{formatTradeDate(event.exDate)}</TableCell>
                <TableCell>
                  {event.paymentDate ? formatTradeDate(event.paymentDate) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(event.eligibleQuantity)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(event.amountPerShare, event.currency)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(event.grossAmount, event.currency)}
                </TableCell>
                <TableCell>
                  <StatusBadge status={event.status} />
                </TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {event.source.replace("_", " ")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
          <p className="text-muted-foreground">
            <Trans id="dividends.rowsShown">
              Showing {firstRow + 1}–
              {Math.min(firstRow + pageSize, data.events.length)} of{" "}
              {data.events.length}
            </Trans>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              <Trans id="dividends.rowsPerPage">Rows per page</Trans>
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPageSize(Number(value));
                setPage(0);
              }}
            >
              <SelectTrigger size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="min-w-24 text-center tabular-nums">
              <Trans id="dividends.pageCount">
                Page {safePage + 1} of {pageCount}
              </Trans>
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={safePage === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              aria-label={i18n._(
                msg({ id: "dividends.previousPage", message: "Previous page" }),
              )}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              disabled={safePage >= pageCount - 1}
              onClick={() =>
                setPage((current) => Math.min(pageCount - 1, current + 1))
              }
              aria-label={i18n._(
                msg({ id: "dividends.nextPage", message: "Next page" }),
              )}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
