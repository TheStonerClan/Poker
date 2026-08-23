"use client";

import { useState, useTransition } from "react";

import {
  applyAddOn,
  bustPlayer,
  rebuyPlayer,
} from "@/app/admin/tournaments/[id]/actions";
import { formatChips } from "@/lib/admin/format";
import type { LatestSnapshot } from "@/lib/admin/chip-snapshots";

import { ChipEditButton } from "./ChipEditButton";
import { KnockoutPicker } from "./KnockoutPicker";
import { ManualColorUpButton } from "./ManualColorUpButton";
import { MovePlayerButton } from "./MovePlayerButton";

type Row = {
  id: string;
  name: string;
  chips: number;
  busted: boolean;
  bustedAtLevel?: number | null;
  buybackUsed: boolean;
  buybackUsedAs?: string | null;
  /**
   * Current table assignment; null for single-table tournaments. A bust
   * doesn't clear it (only `seat_number` does), so a busted row still
   * carries the table they were playing at — used to scope that row's
   * knockout candidates to tablemates.
   */
  tableNumber?: number | null;
  /**
   * This roster row's own `players.id` — needed to exclude the busted
   * player from their own knockout candidate list. Only busted rows
   * need it; omitted from "in play" call sites.
   */
  playerId?: string | null;
  /** Who busted them, if recorded (see KnockoutPicker). */
  knockedOutByPlayerId?: string | null;
  knockedOutByName?: string | null;
  /**
   * Player's most recent self-reported chip total (from /play during a
   * break). Drives the "Logged $X at L5 (+$200)" badge below the name.
   * Null if they haven't logged anything this tournament.
   */
  latestSnapshot?: LatestSnapshot | null;
};

export type TableOption = { number: number; name: string };

export function PlayerGrid({
  currentLevel,
  buybackConfig,
  rows,
  /**
   * "admin" (default): full control, including Rebuy / Add-on (which
   * are financial actions the head admin runs).
   * "table": Out / Chips / Color-up only — hides Rebuy and Add-on
   * since a table admin doesn't take buyback money.
   */
  scope = "admin",
  tableOptions = [],
  knockoutCandidates = [],
}: {
  currentLevel: number;
  buybackConfig: {
    rebuyAllowedThroughLevel?: number;
    addOnAtBreakLevel?: number;
  };
  rows: Row[];
  scope?: "admin" | "table";
  /**
   * Tables in this tournament. Drives the "Move to another table"
   * affordance — only rendered when scope='admin' and at least one
   * other table exists.
   */
  tableOptions?: TableOption[];
  /**
   * Knockout-attribution candidates — every currently in-play (not
   * busted) roster player, from every table; each busted row further
   * filters this down to just its own tableNumber (and excludes its
   * own player_id) so only current tablemates who are still standing
   * show up as "who busted them" options. Omitted (or empty) call
   * sites — e.g. the "in play" grid — simply never render the picker,
   * since it's gated on `r.busted` too.
   */
  knockoutCandidates?: { playerId: string; name: string; tableNumber?: number | null }[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const rebuyOpen =
    scope === "admin" &&
    (buybackConfig.rebuyAllowedThroughLevel == null ||
      currentLevel <= buybackConfig.rebuyAllowedThroughLevel);
  const addOnOpen =
    scope === "admin" &&
    buybackConfig.addOnAtBreakLevel != null &&
    currentLevel === buybackConfig.addOnAtBreakLevel;

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((r) => {
          const canRebuy = !r.busted && false; // can't rebuy without busting
          const showRebuy =
            r.busted && !r.buybackUsed && rebuyOpen;
          const showAddOn = !r.busted && !r.buybackUsed && addOnOpen;
          const showBust = !r.busted;
          const koCandidates = r.busted
            ? knockoutCandidates.filter(
                (c) =>
                  c.playerId !== r.playerId && c.tableNumber === r.tableNumber,
              )
            : [];

          return (
            <li
              key={r.id}
              className={`rounded-md border ${
                r.busted ? "border-fg/10 bg-fg/[0.02]" : "border-fg/15"
              } px-3 py-2.5`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <p
                  className={`truncate text-sm font-semibold ${
                    r.busted ? "text-fg/50 line-through" : "text-fg"
                  }`}
                >
                  {r.name}
                </p>
                <span className="shrink-0 text-xs text-fg/50">
                  {r.busted
                    ? `Out · L${r.bustedAtLevel ?? "?"}`
                    : `${formatChips(r.chips)}`}
                </span>
              </div>
              {r.buybackUsed ? (
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-gold/80">
                  Buyback · {r.buybackUsedAs ?? "used"}
                </p>
              ) : null}
              {r.busted ? (
                <KnockoutPicker
                  tournamentPlayerId={r.id}
                  knockedOutByName={r.knockedOutByName ?? null}
                  candidates={koCandidates}
                />
              ) : null}
              {r.latestSnapshot ? (
                <p className="mt-0.5 text-[10px] tracking-wider text-fg/55">
                  <span className="uppercase">Logged</span>{" "}
                  <span className="font-mono tabular-nums text-fg/80">
                    {formatChips(r.latestSnapshot.chips)}
                  </span>{" "}
                  <span className="uppercase">at L{r.latestSnapshot.levelNum}</span>
                  {r.latestSnapshot.deltaFromPrevious !== 0 ? (
                    <span
                      className={`ml-1 font-mono tabular-nums ${
                        r.latestSnapshot.deltaFromPrevious > 0
                          ? "text-success"
                          : "text-danger"
                      }`}
                    >
                      {r.latestSnapshot.deltaFromPrevious > 0 ? "+" : ""}
                      {formatChips(r.latestSnapshot.deltaFromPrevious)}
                    </span>
                  ) : null}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {showBust ? (
                  <ActionButton
                    label="Out"
                    variant="danger"
                    pending={pendingId === r.id}
                    onClick={() => {
                      setError(null);
                      setPendingId(r.id);
                      start(async () => {
                        const res = await bustPlayer({
                          tournamentPlayerId: r.id,
                        });
                        if (!res.ok) setError(res.error);
                        setPendingId(null);
                      });
                    }}
                  />
                ) : null}
                {canRebuy ? null : null}
                {showRebuy ? (
                  <ActionButton
                    label="Rebuy"
                    variant="gold"
                    pending={pendingId === r.id}
                    onClick={() => {
                      setError(null);
                      setPendingId(r.id);
                      start(async () => {
                        const res = await rebuyPlayer({
                          tournamentPlayerId: r.id,
                        });
                        if (!res.ok) setError(res.error);
                        setPendingId(null);
                      });
                    }}
                  />
                ) : null}
                {showAddOn ? (
                  <ActionButton
                    label="Add-on"
                    variant="gold"
                    pending={pendingId === r.id}
                    onClick={() => {
                      setError(null);
                      setPendingId(r.id);
                      start(async () => {
                        const res = await applyAddOn({
                          tournamentPlayerId: r.id,
                        });
                        if (!res.ok) setError(res.error);
                        setPendingId(null);
                      });
                    }}
                  />
                ) : null}
                {!r.busted ? (
                  <ChipEditButton
                    tournamentPlayerId={r.id}
                    playerName={r.name}
                    currentChips={r.chips}
                  />
                ) : null}
                {!r.busted ? (
                  <ManualColorUpButton
                    tournamentPlayerId={r.id}
                    playerName={r.name}
                    currentChips={r.chips}
                  />
                ) : null}
                {!r.busted && scope === "admin" && tableOptions.length > 1 ? (
                  <MovePlayerButton
                    tournamentPlayerId={r.id}
                    playerName={r.name}
                    currentTableNumber={r.tableNumber ?? null}
                    tableOptions={tableOptions}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ActionButton({
  label,
  variant,
  pending,
  onClick,
}: {
  label: string;
  variant: "danger" | "gold" | "neutral";
  pending: boolean;
  onClick: () => void;
}) {
  const base =
    "inline-flex h-11 min-h-[44px] items-center justify-center rounded-md px-3 text-xs font-semibold uppercase tracking-wider disabled:opacity-50";
  const styles: Record<typeof variant, string> = {
    danger: "border border-danger/60 text-danger",
    gold: "bg-gold text-bg",
    neutral: "border border-fg/15 text-fg/80",
  };
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className={`${base} ${styles[variant]}`}
    >
      {pending ? "…" : label}
    </button>
  );
}
