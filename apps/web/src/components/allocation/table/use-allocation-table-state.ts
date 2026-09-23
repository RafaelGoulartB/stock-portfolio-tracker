import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { type AllocationRow, CASH_TICKER } from "@portifolio-tracker/shared";
import { useState } from "react";
import { FOCUS_QUARTERS_KEY, initialFocusQuarters } from "./marks";

export function useAllocationTableState(
  rows: readonly AllocationRow[],
  onReorder: (tickers: string[]) => void,
) {
  const { i18n } = useLingui();
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusQuarters, setFocusQuarters] =
    useState<Set<string>>(initialFocusQuarters);

  /** Moves one non-cash ticker to the slot currently held by another. */
  function move(ticker: string, target: string) {
    const order = rows
      .filter((row) => row.ticker !== CASH_TICKER)
      .map((row) => row.ticker);
    const from = order.indexOf(ticker);
    const to = order.indexOf(target);

    if (from < 0 || to < 0 || from === to) return;

    order.splice(from, 1);
    order.splice(to, 0, ticker);
    onReorder(order);
    setAnnouncement(
      i18n._(
        t({
          id: "allocation.reorderAnnouncement",
          message: `${ticker} moved to position ${to + 1} of ${order.length}.`,
        }),
      ),
    );
  }

  function moveBy(ticker: string, offset: number) {
    const order = rows
      .filter((row) => row.ticker !== CASH_TICKER)
      .map((row) => row.ticker);
    const from = order.indexOf(ticker);
    const target = order[from + offset];

    if (target !== undefined) move(ticker, target);
  }

  function toggleFocusQuarter(key: string) {
    setFocusQuarters((current) => {
      const next = new Set(current);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      try {
        localStorage.setItem(FOCUS_QUARTERS_KEY, JSON.stringify([...next]));
      } catch {
        // The focus mark still applies for this session.
      }

      return next;
    });
  }

  function finishDragging() {
    setDragging(null);
    setDropTarget(null);
  }

  return {
    announcement,
    dragging,
    dropTarget,
    focusQuarters,
    finishDragging,
    move,
    moveBy,
    setDragging,
    setDropTarget,
    toggleFocusQuarter,
  };
}
