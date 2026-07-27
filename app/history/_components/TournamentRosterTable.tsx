"use client";

import { formatMoney } from "@/lib/admin/format";
import type { PlayerTournamentRow } from "@/lib/admin/history-stats";
import { ordinal } from "@/lib/tv/prize";

import { PlayerLink } from "./PlayerLink";
import { SortableTable, type ColumnDef } from "./SortableTable";

type Props = {
  rows: PlayerTournamentRow[];
  /** History list path ("/history" or "/sandboxadmin/history") — names link to `${basePath}/[player]`. */
  basePath: string;
};

/**
 * Every player who entered one tournament, sortable by any column —
 * the tournament detail page's counterpart to the per-tournament rows
 * on a player's own profile, just inverted (one tournament, all
 * players instead of one player, all tournaments).
 */
export function TournamentRosterTable({ rows, basePath }: Props) {
  const columns: ColumnDef<PlayerTournamentRow, string>[] = [
    {
      key: "name",
      label: "Player",
      align: "left",
      sortKey: (r) => r.playerName.toLowerCase(),
      render: (r) =>
        r.playerId ? (
          <PlayerLink basePath={basePath} playerId={r.playerId} name={r.playerName} />
        ) : (
          <span className="font-semibold text-fg">{r.playerName}</span>
        ),
    },
    {
      key: "position",
      label: "Finish",
      align: "right",
      sortKey: (r) => r.position,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg">
          {r.position != null
            ? ordinal(r.position)
            : r.bustedAtLevel != null
              ? `Out L${r.bustedAtLevel}`
              : "—"}
        </span>
      ),
    },
    {
      key: "knockedOutBy",
      label: "KO'd by",
      align: "left",
      sortKey: (r) => r.knockedOutByName?.toLowerCase() ?? null,
      render: (r) =>
        r.knockedOutByPlayerId && r.knockedOutByName ? (
          <PlayerLink
            basePath={basePath}
            playerId={r.knockedOutByPlayerId}
            name={r.knockedOutByName}
          />
        ) : (
          <span className="text-fg/40">—</span>
        ),
    },
    {
      key: "payout",
      label: "Payout",
      align: "right",
      sortKey: (r) => r.payout,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">
          {r.payout > 0 ? formatMoney(r.payout) : "—"}
        </span>
      ),
    },
    {
      key: "rebuys",
      label: "Rebuys",
      align: "right",
      sortKey: (r) => r.rebuys,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">{r.rebuys}</span>
      ),
    },
    {
      key: "addOns",
      label: "Add-ons",
      align: "right",
      sortKey: (r) => r.addOns,
      render: (r) => (
        <span className="font-mono tabular-nums text-fg/70">{r.addOns}</span>
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
      defaultSort="position"
      defaultDirection="asc"
      getRowId={(r) => r.playerId ?? r.playerName}
      showRank={false}
    />
  );
}
