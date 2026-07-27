"use client";

import type { PlayerStatsRow } from "@/lib/admin/history-stats";

import { PlayerLink } from "./PlayerLink";
import { SortableTable, type ColumnDef } from "./SortableTable";

type Props = {
  rows: PlayerStatsRow[];
  /**
   * Map of `level_num` → display label ("1/2", "2/4", "Break") built
   * from a representative tournament's blind structure (most recent
   * finished tournament). When present, avg bust / rebuy columns
   * render as blind values rather than raw level numbers.
   *
   * Pre-2025 the column was kept as raw `level_num` to handle the
   * pathological case of averaging across tournaments with different
   * blind structures. In practice the league has one structure and
   * the raw number is opaque; the user explicitly asked for blinds.
   */
  levelLabels?: Record<number, string>;
  /** History list path ("/history" or "/sandboxadmin/history") — names link to `${basePath}/[player]`. */
  basePath: string;
};

/**
 * Per-player granular stats table (avg bust level, avg rebuy level,
 * rebuy rate, etc). All numeric columns sortable; default sort is by
 * tournaments played so the most-active regulars surface first.
 *
 * Avg bust / rebuy levels render as blind values ("1/2", "2/4") when
 * a representative blind structure is in scope, falling back to raw
 * `L{num}` otherwise. Rounding to the nearest integer level before
 * the lookup picks the "modal" level for fractional averages — a
 * player whose avg bust is L4.2 most commonly busts during the L4
 * blinds.
 */
export function PerPlayerStatsTable({ rows, levelLabels, basePath }: Props) {
  function blindLabel(avg: number | null): string {
    if (avg == null) return "—";
    if (levelLabels) {
      const rounded = Math.round(avg);
      const found = levelLabels[rounded];
      if (found) return found;
    }
    return `L${avg.toFixed(1)}`;
  }

  const columns: ColumnDef<PlayerStatsRow, string>[] = [
    {
      key: "name",
      label: "Player",
      align: "left",
      sortKey: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span>
          <PlayerLink basePath={basePath} playerId={r.playerId} name={r.name} />
          <span className="ml-2 text-[10px] uppercase tracking-widest text-fg/40">
            {r.tournamentsPlayed} pl
          </span>
        </span>
      ),
    },
    {
      key: "avgBust",
      label: "Avg bust",
      align: "right",
      sortKey: (r) => r.avgBustLevel,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">
          {blindLabel(r.avgBustLevel)}
        </span>
      ),
    },
    {
      key: "avgRebuy",
      label: "Avg rebuy",
      align: "right",
      sortKey: (r) => r.avgRebuyLevel,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">
          {blindLabel(r.avgRebuyLevel)}
        </span>
      ),
    },
    {
      key: "rebuyRate",
      label: "Rebuy %",
      align: "right",
      sortKey: (r) => r.rebuyRate,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">
          {r.tournamentsPlayed > 0
            ? `${Math.round(r.rebuyRate * 100)}%`
            : "—"}
        </span>
      ),
    },
    {
      key: "addOns",
      label: "Add-ons",
      align: "right",
      sortKey: (r) => r.totalAddOns,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">
          {r.totalAddOns}
        </span>
      ),
    },
    {
      key: "avgFinish",
      label: "Avg finish",
      align: "right",
      sortKey: (r) => r.avgFinish,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">
          {r.avgFinish != null ? r.avgFinish.toFixed(1) : "—"}
        </span>
      ),
    },
  ];

  return (
    <SortableTable
      rows={rows}
      columns={columns}
      defaultSort="name"
      defaultDirection="asc"
      getRowId={(r) => r.playerId}
      highlightTopRowClass=""
    />
  );
}
