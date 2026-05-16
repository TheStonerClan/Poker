"use client";

import { formatMoney } from "@/lib/admin/format";
import type { PlayerStatsRow } from "@/lib/admin/history-stats";

import { SortableTable, type ColumnDef } from "./SortableTable";

type Props = {
  rows: PlayerStatsRow[];
  /** Cap visible rows. Defaults to 15. */
  maxRows?: number;
};

/**
 * Season leaderboard — F1-style points + the standard money columns.
 * Defaults to sorting by points; admin can re-sort by wins, ITM,
 * gross, or net with a header tap.
 */
export function SeasonLeaderboardTable({ rows, maxRows = 15 }: Props) {
  const columns: ColumnDef<PlayerStatsRow, string>[] = [
    {
      key: "name",
      label: "Player",
      align: "left",
      sortable: true,
      sortKey: (r) => r.name.toLowerCase(),
      render: (r) => <span className="font-semibold text-fg">{r.name}</span>,
    },
    {
      key: "played",
      label: "Played",
      align: "right",
      sortKey: (r) => r.tournamentsPlayed,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">
          {r.tournamentsPlayed}
        </span>
      ),
    },
    {
      key: "points",
      label: "Points",
      align: "right",
      sortKey: (r) => r.points,
      render: (r) => (
        <span className="font-mono tabular-nums font-semibold text-fg">
          {r.points}
        </span>
      ),
    },
    {
      key: "wins",
      label: "Wins",
      align: "right",
      sortKey: (r) => r.wins,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">{r.wins}</span>
      ),
    },
    {
      key: "itm",
      label: "ITM",
      align: "right",
      sortKey: (r) => r.itmCount,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">{r.itmCount}</span>
      ),
    },
    {
      key: "gross",
      label: "Gross",
      align: "right",
      sortKey: (r) => r.grossWinnings,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg">
          {formatMoney(r.grossWinnings)}
        </span>
      ),
    },
    {
      key: "costBasis",
      label: "Cost",
      align: "right",
      sortKey: (r) => r.costBasis,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/55">
          {formatMoney(r.costBasis)}
        </span>
      ),
    },
    {
      key: "net",
      label: "Net",
      align: "right",
      sortKey: (r) => r.net,
      render: (r) => (
        <span
          className={`font-mono tabular-nums font-semibold ${
            r.net >= 0 ? "text-success" : "text-danger"
          }`}
        >
          {r.net >= 0 ? "+" : ""}
          {formatMoney(r.net)}
        </span>
      ),
    },
  ];

  return (
    <SortableTable
      rows={rows}
      columns={columns}
      defaultSort="points"
      defaultDirection="desc"
      getRowId={(r) => r.playerId}
      showRank
      maxRows={maxRows}
    />
  );
}
