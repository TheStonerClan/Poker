"use client";

import { useState, useTransition } from "react";

import {
  applyAddOn,
  bustPlayer,
  rebuyPlayer,
} from "@/app/admin/tournaments/[id]/actions";
import { formatChips } from "@/lib/admin/format";
import type { LatestSnapshot } from "@/lib/admin/chip-snapshots";

import { ManualColorUpButton } from "./ManualColorUpButton";

type Row = {
  id: string;
  name: string;
  chips: number;
  busted: boolean;
  bustedAtLevel?: number | null;
  buybackUsed: boolean;
  buybackUsedAs?: string | null;
  /**
   * Player's most recent self-reported chip total (from /play during a
   * break). Drives the "Logged $X at L5 (+$200)" badge below the name.
   * Null if they haven't logged anything this tournament.
   */
  latestSnapshot?: LatestSnapshot | null;
};

export function PlayerGrid({
  currentLevel,
  buybackConfig,
  rows,
}: {
  currentLevel: number;
  buybackConfig: {
    rebuyAllowedThroughLevel?: number;
    addOnAtBreakLevel?: number;
  };
  rows: Row[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  const rebuyOpen =
    buybackConfig.rebuyAllowedThroughLevel == null ||
    currentLevel <= buybackConfig.rebuyAllowedThroughLevel;
  const addOnOpen =
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
                  <ManualColorUpButton
                    tournamentPlayerId={r.id}
                    playerName={r.name}
                    currentChips={r.chips}
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
