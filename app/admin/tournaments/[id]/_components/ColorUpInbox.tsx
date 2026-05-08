"use client";

import { useState, useTransition } from "react";

import { decideColorUp } from "@/app/admin/tournaments/[id]/actions";

type Request = {
  id: string;
  player: { id: string; name: string } | null;
  submitted_chips: unknown;
  exchange_for_chips: unknown;
  created_at: string;
};

function summarize(value: unknown): string {
  if (!Array.isArray(value)) return "—";
  return value
    .map((v: { color?: string; value?: number; count?: number }) => {
      const head = v.color ?? `${v.value ?? ""}`;
      return `${v.count ?? 0}× ${head}`;
    })
    .join(", ");
}

export function ColorUpInbox({ requests }: { requests: Request[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  return (
    <ul className="flex flex-col gap-2">
      {requests.map((r) => (
        <li
          key={r.id}
          className="rounded-md border border-fg/10 bg-bg/40 px-3 py-2 text-sm"
        >
          <p className="font-medium text-fg">{r.player?.name ?? "—"}</p>
          <p className="text-xs text-fg/60">
            Submitting: {summarize(r.submitted_chips)}
          </p>
          <p className="text-xs text-fg/60">
            For: {summarize(r.exchange_for_chips)}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pendingId === r.id}
              onClick={() => {
                setPendingId(r.id);
                start(async () => {
                  try {
                    await decideColorUp({ requestId: r.id, decision: "approved" });
                  } finally {
                    setPendingId(null);
                  }
                });
              }}
              className="inline-flex h-11 min-h-[44px] flex-1 items-center justify-center rounded-md bg-success/80 px-3 text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pendingId === r.id}
              onClick={() => {
                setPendingId(r.id);
                start(async () => {
                  try {
                    await decideColorUp({ requestId: r.id, decision: "denied" });
                  } finally {
                    setPendingId(null);
                  }
                });
              }}
              className="inline-flex h-11 min-h-[44px] flex-1 items-center justify-center rounded-md border border-fg/15 px-3 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
