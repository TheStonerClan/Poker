"use client";

import { useState, useTransition } from "react";

import { finalizeTournament } from "@/app/admin/tournaments/[id]/actions";

type Props = {
  tournamentId: string;
  disabled?: boolean;
  /**
   * How many players are still in play. The action only allows manual
   * finalize when this is exactly 2 (the last bust auto-finalizes when 1
   * remains). The button surfaces the relevant state instead of letting
   * users click into a server-side error.
   */
  inPlayCount: number;
};

export function FinalizeButton({ tournamentId, disabled, inPlayCount }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [chopTopTwo, setChopTopTwo] = useState(false);
  const [pending, start] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (disabled) {
    return (
      <p className="mt-3 rounded-md border border-fg/10 px-3 py-2 text-xs text-fg/50">
        Already finalized.
      </p>
    );
  }

  if (inPlayCount > 2) {
    return (
      <p className="mt-3 rounded-md border border-fg/10 px-3 py-2 text-xs text-fg/50">
        Manual finalize is only available with exactly 2 players still in play
        (currently {inPlayCount}). The last bust auto-finalizes when 1 remains.
      </p>
    );
  }

  if (inPlayCount < 2) {
    // 1 in play means the auto-finalize-on-last-bust path should have run.
    // 0 means everyone busted (edge case — usually finished_at is set by then).
    return (
      <p className="mt-3 rounded-md border border-fg/10 px-3 py-2 text-xs text-fg/50">
        {inPlayCount === 1
          ? "Down to a single player — the next bust auto-finalizes. Manual finalize is disabled."
          : "No players in play — nothing to finalize."}
      </p>
    );
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-12 min-h-[44px] rounded-md border border-fg/20 text-sm font-semibold text-fg/80"
        >
          Finalize tournament (heads-up)
        </button>
      ) : (
        <>
          <p className="text-xs text-danger">
            Snapshot results and lock the tournament?
          </p>

          <label className="flex items-start gap-2 rounded-md border border-fg/15 px-3 py-2 text-sm text-fg/80">
            <input
              type="checkbox"
              checked={chopTopTwo}
              onChange={(e) => setChopTopTwo(e.target.checked)}
              disabled={pending}
              className="mt-1 h-4 w-4 accent-[var(--color-gold)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">
                Chop pot — 1st &amp; 2nd tied
              </span>
              <span className="text-xs text-fg/60">
                Combine the top two payouts and split evenly. Both finishers
                get labeled &ldquo;tied for 1st&rdquo;. Use when the final two
                players agree to chop instead of playing it out.
              </span>
            </span>
          </label>

          {errorMsg ? (
            <p
              role="alert"
              className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {errorMsg}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setErrorMsg(null);
                  try {
                    await finalizeTournament(tournamentId, { chopTopTwo });
                  } catch (e) {
                    setErrorMsg(
                      e instanceof Error
                        ? e.message
                        : "Could not finalize. Try again.",
                    );
                  }
                })
              }
              className="h-12 min-h-[44px] flex-1 rounded-md bg-danger/90 text-sm font-semibold text-bg disabled:opacity-50"
            >
              {pending
                ? "Finalizing…"
                : chopTopTwo
                  ? "Yes, finalize (chopped)"
                  : "Yes, finalize"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConfirming(false);
                setErrorMsg(null);
              }}
              className="h-12 min-h-[44px] flex-1 rounded-md border border-fg/15 text-sm font-semibold text-fg/80 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
