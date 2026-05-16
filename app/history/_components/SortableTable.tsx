"use client";

import { useMemo, useState } from "react";

export type Direction = "asc" | "desc";

export type ColumnDef<T, K extends string> = {
  /** Stable key — used as the sort identifier. */
  key: K;
  /** Header text. */
  label: string;
  /**
   * Whether this column is sortable. Defaults to true; pass false for
   * a column like "Player" / row name where sorting doesn't make sense.
   */
  sortable?: boolean;
  /**
   * Alignment of the cell. Most metric columns are right-aligned with
   * tabular-nums; the leading name column is left-aligned.
   */
  align?: "left" | "right";
  /**
   * Sort key extractor. Numbers sort numerically, nulls sort last in
   * both directions (a null player who never busted shouldn't outrank
   * a player with a real average).
   */
  sortKey?: (row: T) => number | string | null | undefined;
  /** Cell renderer. */
  render: (row: T) => React.ReactNode;
  /** Extra Tailwind classes applied to the <td>. */
  cellClass?: string;
};

type Props<T, K extends string> = {
  rows: T[];
  columns: ColumnDef<T, K>[];
  /** Initial sort column key. Must match a sortable column. */
  defaultSort: K;
  defaultDirection?: Direction;
  /** Stable row key extractor. */
  getRowId: (row: T, index: number) => string;
  /** Optional className applied to the leader's <tr> (highlights #1). */
  highlightTopRowClass?: string;
  /** Optional: show position numbers in the leading column. */
  showRank?: boolean;
  /** Optional: cap visible rows (renders a "+N more" hint). */
  maxRows?: number;
};

/**
 * Generic sortable table for the historics page. Sorting is purely
 * client-side over a fixed row set — re-renders on header click. The
 * column definitions carry the sort key extractor so we can rank by
 * numbers, strings, or anything reducible to a comparable.
 *
 * Direction toggles on repeat click of the active column. Switching
 * to a new column resets to "desc" for numeric columns (the usual
 * "biggest first" expectation) and "asc" for string columns.
 */
export function SortableTable<T, K extends string>({
  rows,
  columns,
  defaultSort,
  defaultDirection = "desc",
  getRowId,
  highlightTopRowClass = "bg-gold/5",
  showRank = false,
  maxRows,
}: Props<T, K>) {
  const [sortKey, setSortKey] = useState<K>(defaultSort);
  const [direction, setDirection] = useState<Direction>(defaultDirection);

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col || !col.sortKey) return rows;
    const extract = col.sortKey;
    const dir = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = extract(a);
      const vb = extract(b);
      // Nulls always sort last regardless of direction.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [rows, columns, sortKey, direction]);

  const visible = maxRows != null ? sorted.slice(0, maxRows) : sorted;
  const hiddenCount = sorted.length - visible.length;

  function onHeaderClick(col: ColumnDef<T, K>) {
    if (col.sortable === false) return;
    if (col.key === sortKey) {
      setDirection((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(col.key);
    // Default to desc for numeric, asc for string. Cheap heuristic
    // based on the first non-null value the extractor returns.
    const first = col.sortKey?.(rows[0]);
    setDirection(typeof first === "string" ? "asc" : "desc");
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-fg/55">
            {showRank ? <th className="py-1.5 pr-3">#</th> : null}
            {columns.map((col) => {
              const isActive = col.key === sortKey;
              const isSortable = col.sortable !== false && !!col.sortKey;
              const alignClass = col.align === "right" ? "text-right" : "";
              return (
                <th
                  key={col.key}
                  className={`py-1.5 pr-3 ${alignClass}`}
                  aria-sort={
                    isActive
                      ? direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() => onHeaderClick(col)}
                      className={`inline-flex items-baseline gap-1 uppercase tracking-widest hover:text-fg ${
                        isActive ? "text-fg" : ""
                      }`}
                    >
                      <span>{col.label}</span>
                      <span aria-hidden className="text-fg/40">
                        {isActive ? (direction === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    <span>{col.label}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, i) => (
            <tr
              key={getRowId(row, i)}
              className={`border-t border-fg/5 ${
                i === 0 ? highlightTopRowClass : ""
              }`}
            >
              {showRank ? (
                <td className="py-1.5 pr-3 font-mono text-fg/55 tabular-nums">
                  {i + 1}
                </td>
              ) : null}
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={`py-1.5 pr-3 ${
                    col.align === "right" ? "text-right" : ""
                  } ${col.cellClass ?? ""}`}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 ? (
        <p className="mt-2 text-[10px] uppercase tracking-widest text-fg/40">
          +{hiddenCount} more{maxRows != null ? ` · top ${maxRows} shown` : ""}.
        </p>
      ) : null}
    </div>
  );
}
