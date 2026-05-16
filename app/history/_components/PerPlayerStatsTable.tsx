"use client";

import type { PlayerStatsRow } from "@/lib/admin/history-stats";

import { SortableTable, type ColumnDef } from "./SortableTable";

type Props = {
  rows: PlayerStatsRow[];
};

/**
 * Per-player granular stats table (avg bust level, avg rebuy level,
 * rebuy rate, etc). All numeric columns sortable; default sort is by
 * tournaments played so the most-active regulars surface first.
 *
 * Avg bust / rebuy levels are kept as raw `level_num` (not "L4" /
 * "B2") on purpose — the averages span tournaments with potentially
 * different blind structures, so a fractional `level_num` is the only
 * well-defined unit. The TV and tournament-detail labels (where one
 * structure is in scope) DO use B#/L#.
 */
export function PerPlayerStatsTable({ rows }: Props) {
  const columns: ColumnDef<PlayerStatsRow, string>[] = [
    {
      key: "name",
      label: "Player",
      align: "left",
      sortKey: (r) => r.name.toLowerCase(),
      render: (r) => (
        <span className="font-semibold text-fg">
          {r.name}
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
          {r.avgBustLevel != null ? `L${r.avgBustLevel.toFixed(1)}` : "—"}
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
          {r.avgRebuyLevel != null ? `L${r.avgRebuyLevel.toFixed(1)}` : "—"}
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
