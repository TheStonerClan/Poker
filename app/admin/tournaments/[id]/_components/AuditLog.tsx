"use client";

import { useState, useTransition } from "react";

import { undoEvent } from "@/app/admin/tournaments/[id]/actions";
import { formatChips } from "@/lib/admin/format";

export type AuditLogEntry = {
  id: string;
  type: "bust" | "rebuy" | "addon" | "chip_adjust";
  createdAt: string;
  playerName: string;
  description: string;
  undone: boolean;
};

type Props = {
  tournamentId: string;
  entries: AuditLogEntry[];
};

const TYPE_LABEL: Record<AuditLogEntry["type"], string> = {
  bust: "Out",
  rebuy: "Rebuy",
  addon: "Add-on",
  chip_adjust: "Chip edit",
};

const TYPE_TONE: Record<AuditLogEntry["type"], string> = {
  bust: "text-danger",
  rebuy: "text-success",
  addon: "text-gold",
  chip_adjust: "text-fg/70",
};

/**
 * Reverse-chronological log of bust/rebuy/addon/chip-edit actions this
 * tournament, each with an admin-only "Undo" control — the safety net for
 * "I marked someone out by mistake and didn't notice for several
 * actions." Requires a second tap to confirm since undo mutates chip
 * counts and can reopen a finalized tournament.
 */
export function AuditLog({ tournamentId, entries }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  if (entries.length === 0) {
    return <p className="text-sm text-fg/50">No actions logged yet.</p>;
  }

  return (
    <div>
      {error ? (
        <p
          role="alert"
          className="mb-2 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1.5">
        {entries.map((e) => (
          <li
            key={e.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
              e.undone ? "border-fg/5 text-fg/35" : "border-fg/10"
            }`}
          >
            <span className="flex items-baseline gap-2 min-w-0">
              <span
                className={`w-16 shrink-0 text-xs font-semibold uppercase tracking-wider ${
                  e.undone ? "text-fg/30" : TYPE_TONE[e.type]
                }`}
              >
                {TYPE_LABEL[e.type]}
              </span>
              <span className="truncate font-semibold">{e.playerName}</span>
              <span className="truncate text-fg/60">{e.description}</span>
            </span>

            {e.undone ? (
              <span className="text-xs uppercase tracking-wider text-fg/35">
                Undone
              </span>
            ) : confirmingId === e.id ? (
              <span className="flex items-center gap-1.5">
                <span className="text-xs text-danger">Undo this?</span>
                <button
                  type="button"
                  disabled={pendingId === e.id}
                  onClick={() => {
                    setError(null);
                    setPendingId(e.id);
                    start(async () => {
                      const res = await undoEvent({
                        tournamentId,
                        eventId: e.id,
                      });
                      if (!res.ok) setError(res.error);
                      setPendingId(null);
                      setConfirmingId(null);
                    });
                  }}
                  className="h-8 rounded-md bg-danger px-2.5 text-xs font-semibold uppercase tracking-wider text-white disabled:opacity-50"
                >
                  {pendingId === e.id ? "…" : "Confirm"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="h-8 rounded-md border border-fg/15 px-2.5 text-xs uppercase tracking-wider text-fg/60"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingId(e.id)}
                className="h-8 rounded-md border border-fg/15 px-2.5 text-xs uppercase tracking-wider text-fg/70"
              >
                Undo
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function formatAuditDescription(
  type: AuditLogEntry["type"],
  payload: Record<string, unknown>,
): string {
  const level = payload.at_level as number | null | undefined;
  if (type === "bust") return `Out at L${level ?? "?"}`;
  if (type === "rebuy") {
    const chips = payload.chips as number | undefined;
    return `Rebuy at L${level ?? "?"} (+${formatChips(chips ?? 0)})`;
  }
  if (type === "addon") {
    const chips = payload.chips_added as number | undefined;
    return `Add-on at L${level ?? "?"} (+${formatChips(chips ?? 0)})`;
  }
  // chip_adjust
  const before = payload.before as number | undefined;
  const after = payload.after as number | undefined;
  const reason = payload.reason as string | null | undefined;
  return `${formatChips(before ?? 0)} → ${formatChips(after ?? 0)}${reason ? ` — ${reason}` : ""}`;
}
