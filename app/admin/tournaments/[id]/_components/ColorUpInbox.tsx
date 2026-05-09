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
  if (!value || typeof value !== "object") return "—";
  // The /play action stores the request as `{ total: number, chips: [...] }`
  // (wrapped object), but earlier shapes wrote a raw chip array. Handle
  // both: peel off `chips` if present, otherwise treat the whole value as
  // the array. Without this peel the inbox renders "—" for every request.
  const chips =
    "chips" in value
      ? (value as { chips?: unknown }).chips
      : value;
  const total =
    "total" in value
      ? (value as { total?: number }).total
      : undefined;
  if (!Array.isArray(chips)) return total != null ? `$${total}` : "—";

  const summary = chips
    .filter((v): v is { value?: number; count?: number; color?: string } =>
      typeof v === "object" && v !== null,
    )
    .map((v) => {
      const head = typeof v.value === "number" ? `$${v.value}` : (v.color ?? "?");
      return `${v.count ?? 0}× ${head}`;
    })
    .filter((s) => !s.startsWith("0×"))
    .join(", ");

  if (!summary) return total != null ? `$${total}` : "—";
  return total != null ? `${summary} (= $${total})` : summary;
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
