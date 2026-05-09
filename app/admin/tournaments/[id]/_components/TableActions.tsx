"use client";

import { useState, useTransition } from "react";

import {
  balanceTables,
  mergeTables,
} from "@/app/admin/tournaments/[id]/actions";

type Props = {
  tournamentId: string;
  /** Current spread (max - min) of active players per table. */
  spread: number;
  /** True iff the largest table can fit every active player (merge feasible). */
  mergeFeasible: boolean;
  /** Total active players across all tables — drives the merge confirm copy. */
  activeCount: number;
};

/**
 * Endgame consolidation controls for the live admin tournament page.
 * Two server actions surface here:
 *
 * - **Balance**: redistribute active players so no table is more than
 *   one ahead of any other. Useful when busts have left one table
 *   short-handed while another still has 4+.
 * - **Merge**: consolidate everyone onto the largest table once the
 *   field has shrunk enough to fit. Visible only when the merge would
 *   actually fit (active ≤ largest cap).
 *
 * Both actions return the standard `{ ok, error? }` shape so production
 * error messages survive Next 16's redaction.
 */
export function TableActions({
  tournamentId,
  spread,
  mergeFeasible,
  activeCount,
}: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"balance" | "merge" | null>(
    null,
  );

  const balanceEnabled = spread >= 2;

  if (!balanceEnabled && !mergeFeasible) {
    // Nothing to do — tables are balanced and merge isn't an option yet.
    return null;
  }

  function reset() {
    setConfirming(null);
    setError(null);
  }

  function runBalance() {
    setError(null);
    start(async () => {
      const res = await balanceTables(tournamentId);
      if (!res.ok) setError(res.error);
      else reset();
    });
  }

  function runMerge() {
    setError(null);
    start(async () => {
      const res = await mergeTables(tournamentId);
      if (!res.ok) setError(res.error);
      else reset();
    });
  }

  return (
    <section className="rounded-md border border-fg/10 p-3">
      <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
        Table actions
      </h2>

      {confirming === "balance" ? (
        <div className="flex flex-col gap-2 rounded-md border border-fg/15 bg-fg/[0.02] p-3">
          <p className="text-xs text-fg/70">
            Move active players around so no table is more than one
            ahead of any other? Busted players stay at their original
            table for the record.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={reset}
              className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={runBalance}
              className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
            >
              {pending ? "Balancing…" : "Yes, balance"}
            </button>
          </div>
        </div>
      ) : confirming === "merge" ? (
        <div className="flex flex-col gap-2 rounded-md border border-gold/40 bg-gold/5 p-3">
          <p className="text-xs text-fg/70">
            Move all {activeCount} active player
            {activeCount === 1 ? "" : "s"} onto the largest table?
            Busted players keep their original assignments. Re-balance
            isn&apos;t available afterward (only one table left).
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={reset}
              className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={runMerge}
              className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
            >
              {pending ? "Merging…" : "Yes, merge"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setConfirming("balance")}
            disabled={!balanceEnabled}
            className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 px-3 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-40"
            title={
              balanceEnabled
                ? "Redistribute active players across tables"
                : "Tables are already balanced"
            }
          >
            Balance tables
          </button>
          <button
            type="button"
            onClick={() => setConfirming("merge")}
            disabled={!mergeFeasible}
            className="h-11 min-h-[44px] flex-1 rounded-md border border-gold/40 px-3 text-xs font-semibold uppercase tracking-wider text-gold disabled:opacity-40"
            title={
              mergeFeasible
                ? "Consolidate everyone onto the largest table"
                : "Field is too big to fit at one table yet"
            }
          >
            Merge to one table
          </button>
        </div>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
