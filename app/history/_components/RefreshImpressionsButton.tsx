"use client";

import { useState, useTransition } from "react";

import { refreshPlayerImpressions } from "@/app/history/actions";

/**
 * Admin-only trigger for `refreshAllPlayerImpressions`, which
 * otherwise only runs automatically right after a tournament
 * finalizes. Regenerates EVERY player's blurb in this scope in one
 * batched call — not just whichever player's page this button was
 * clicked from — so the label makes that explicit rather than
 * implying a single-player refresh.
 */
export function RefreshImpressionsButton({
  isSandbox,
}: {
  isSandbox: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<
    { kind: "error"; message: string } | { kind: "done"; count: number } | null
  >(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setResult(null);
          start(async () => {
            const res = await refreshPlayerImpressions({ isSandbox });
            setResult(
              res.status === "ok"
                ? { kind: "done", count: res.count }
                : { kind: "error", message: res.message },
            );
          });
        }}
        className="inline-flex h-7 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-gold/40 px-2 text-[10px] font-semibold uppercase tracking-wider text-gold/80 disabled:opacity-50"
      >
        {pending ? "Refreshing…" : "Refresh all"}
      </button>
      {result?.kind === "error" ? (
        <p role="alert" className="max-w-[16rem] text-right text-[10px] text-danger">
          {result.message}
        </p>
      ) : result?.kind === "done" ? (
        <p className="text-[10px] text-fg/40">
          Regenerated {result.count} player{result.count === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}
