"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  cancelScheduledTournament,
  deleteFinalizedTournament,
} from "@/app/admin/tournaments/[id]/actions";

type Props = {
  tournamentId: string;
  /**
   * Drives the verb, copy, and which server action runs:
   *   - "cancel": pre-start cleanup (status='scheduled')
   *   - "delete": post-finalize cleanup (status='finished'), for dummy
   *     tournaments the admin doesn't want polluting /history.
   * Both end up doing the same hard delete server-side; the labels
   * differ so the admin sees what they're about to do in the right
   * context.
   */
  mode: "cancel" | "delete";
};

export function DeleteTournamentButton({ tournamentId, mode }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const copy =
    mode === "cancel"
      ? {
          trigger: "Cancel tournament",
          prompt:
            "Cancel this tournament and discard the staged roster? The tournament and its assigned seats will be removed entirely.",
          confirm: pending ? "Cancelling…" : "Yes, cancel tournament",
        }
      : {
          trigger: "Delete tournament",
          prompt:
            "Permanently delete this tournament? Results, payouts, and event history will be wiped. This cannot be undone — use only for test/dummy tournaments.",
          confirm: pending ? "Deleting…" : "Yes, delete tournament",
        };

  function run() {
    setError(null);
    start(async () => {
      const res =
        mode === "cancel"
          ? await cancelScheduledTournament(tournamentId)
          : await deleteFinalizedTournament(tournamentId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Server actions can't `redirect()` from a Promise-returning
      // wrapper, so navigate from the client once the row is gone.
      router.push("/admin/tournaments");
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="h-11 min-h-[44px] rounded-md border border-danger/40 px-3 text-xs font-semibold uppercase tracking-wider text-danger"
        >
          {copy.trigger}
        </button>
        {error ? (
          <p
            role="alert"
            className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger/5 p-3">
      <p className="text-xs text-fg/80">{copy.prompt}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
        >
          Keep it
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={run}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-danger/90 text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {copy.confirm}
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
