"use client";

import { useState } from "react";

import { selfReportBust } from "@/app/play/[sessionId]/actions";
import { getOrCreateAnonSession } from "@/lib/presence";

type Props = {
  sessionId: string;
  playerId: string;
  playerName: string;
  onBusted: () => void;
};

type Stage = "idle" | "confirming" | "submitting" | "error";

export function BustTab({ sessionId, playerId, playerName, onBusted }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function confirmBust() {
    setStage("submitting");
    setErrorMsg(null);
    onBusted(); // optimistic — flip the UI immediately
    const res = await selfReportBust({
      tournamentId: sessionId,
      playerId,
      anonSession: getOrCreateAnonSession(),
    });
    if (!res.ok) {
      setStage("error");
      setErrorMsg(res.error);
      return;
    }
    // onBusted already moved the UI; nothing else to do.
  }

  if (stage === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p className="rounded-2xl border border-danger/60 bg-danger/10 p-4 text-danger">
          Couldn&apos;t report bust: {errorMsg}. Tell the admin in person.
        </p>
        <button
          type="button"
          className="rounded-2xl border border-fg/20 px-5 py-4 text-fg"
          onClick={() => setStage("idle")}
        >
          Try again
        </button>
      </div>
    );
  }

  if (stage === "confirming" || stage === "submitting") {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-danger/60 bg-danger/10 p-5">
          <p className="text-label text-xs uppercase tracking-widest">
            Are you sure?
          </p>
          <p className="mt-2 text-fg">
            <strong>{playerName}</strong> will be marked out. The admin will see
            this in the bust queue.
          </p>
        </div>
        <button
          type="button"
          disabled={stage === "submitting"}
          onClick={confirmBust}
          className="rounded-2xl border border-danger/80 bg-danger/20 px-5 py-5 text-lg font-semibold uppercase tracking-widest text-danger disabled:opacity-60"
        >
          {stage === "submitting" ? "Reporting…" : "Yes, I'm out"}
        </button>
        <button
          type="button"
          className="rounded-2xl border border-fg/20 px-5 py-4 text-fg/80"
          onClick={() => setStage("idle")}
          disabled={stage === "submitting"}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-gold/30 bg-bg/40 p-5">
        <p className="text-label text-xs uppercase tracking-widest">
          Self-report
        </p>
        <p className="mt-2 text-fg/80">
          Tap below when you&apos;re out. The admin can override if needed.
        </p>
      </div>
      <button
        type="button"
        onClick={() => setStage("confirming")}
        className="rounded-2xl border border-danger/80 bg-danger/15 px-5 py-6 text-xl font-semibold uppercase tracking-widest text-danger"
      >
        I&apos;m out
      </button>
    </div>
  );
}
