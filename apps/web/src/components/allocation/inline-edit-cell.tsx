import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type InlineEditCellProps = {
  /** Formatted value shown when the cell is idle. */
  display: string | null;
  /** Raw text the editor starts from, already localized. */
  text: string;
  /** Announced by screen readers and used as the input label. */
  label: string;
  placeholder?: string;
  /** Hover tooltip; defaults to `label`. */
  title?: string;
  /** Extra classes for the idle button, e.g. a P&L tone. */
  className?: string;
  disabled?: boolean;
  inputMode?: "decimal" | "text";
  /** Receives the raw text; an empty string means "clear this value". */
  onCommit: (text: string) => void;
};

/**
 * A table cell that turns into an input on click. Enter and blur commit,
 * Escape restores the stored value, and an empty commit clears the field.
 *
 * Parsing stays with the caller: the cell only carries text around, so a
 * percent, a grade and a free-text reference share one interaction.
 */
export function InlineEditCell({
  display,
  text,
  label,
  placeholder,
  title,
  className,
  disabled = false,
  inputMode = "decimal",
  onCommit,
}: InlineEditCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const committed = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.select();
    }
  }, [editing]);

  function open() {
    if (disabled) {
      return;
    }

    setDraft(text);
    committed.current = false;
    setEditing(true);
  }

  function commit() {
    if (committed.current) {
      return;
    }

    committed.current = true;
    setEditing(false);

    if (draft.trim() !== text.trim()) {
      onCommit(draft);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        // biome-ignore lint/a11y/noAutofocus: the cell was just activated
        autoFocus
        aria-label={label}
        value={draft}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            committed.current = true;
            setEditing(false);
          }
        }}
        className="h-7 w-full rounded-sm border border-ring bg-background px-1.5 text-right text-xs tabular-nums outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      disabled={disabled}
      aria-label={label}
      title={title ?? label}
      className={cn(
        "h-7 w-full rounded-sm px-1.5 text-right text-xs tabular-nums transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        display === null && "text-muted-foreground",
        className,
      )}
    >
      {display ?? placeholder ?? "—"}
    </button>
  );
}
