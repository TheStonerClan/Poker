"use client";

import { useState, useTransition } from "react";

import { awardPots, cancelHand } from "@/app/admin/tournaments/[id]/hand-actions";
import { formatChips } from "@/lib/admin/format";

type Eligible = { tournament_player_id: string; name: string };
type PotPreview = { kind: string; amount: number; eligible: Eligible[] };

/**
 * Showdown picker. Renders one row per pot (main + any side pots
 * surfaced by `computePotStructure`). For each pot the admin
 * multi-selects winners; ties split evenly with the remainder going
 * to the first listed winner.
 *
 * Single-eligible pots auto-fill so the admin only has to confirm
 * the "real" decision points.
 */
export function ShowdownPanel({
  handId,
  pot,
  pots,
}: {
  handId: string;
  pot: number;
  pots: PotPreview[];
}) {
  // choices[potKind] = array of selected tournament_player_ids
  const [choices, setChoices] = useState<Record<string, string[]>>(() => {
    const init: Record<string, string[]> = {};
    for (const p of pots) {
      init[p.kind] = p.eligible.length === 1 ? [p.eligible[0].tournament_player_id] : [];
    }
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(potKind: string, playerId: string) {
    setChoices((prev) => {
      const current = prev[potKind] ?? [];
      const next = current.includes(playerId)
        ? current.filter((id) => id !== playerId)
        : [...current, playerId];
      return { ...prev, [potKind]: next };
    });
  }

  function award() {
    setError(null);
    start(async () => {
      const res = await awardPots({ handId, choices });
      if (!res.ok) setError(res.error);
    });
  }

  function cancel() {
    if (
      !confirm(
        "Cancel this hand without awarding? Chips will stay where they were at hand start.",
      )
    ) {
      return;
    }
    setError(null);
    start(async () => {
      const res = await cancelHand({ handId });
      if (!res.ok) setError(res.error);
    });
  }

  const allChosen = pots.every((p) => (choices[p.kind]?.length ?? 0) > 0);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-gold/40 bg-gold/5 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
          Showdown
        </h2>
        <p className="font-mono text-sm tabular-nums text-gold">
          Pot {formatChips(pot)}
        </p>
      </div>

      {pots.length === 0 ? (
        <p className="text-sm text-fg/55">
          No pot to award. Cancel the hand.
        </p>
      ) : null}

      {pots.map((p) => (
        <div
          key={p.kind}
          className="flex flex-col gap-2 rounded-md border border-fg/15 bg-bg/40 p-3"
        >
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-fg/80">
              {p.kind === "main"
                ? "Main pot"
                : p.kind === "uncontested"
                  ? "Uncontested"
                  : `Side pot ${p.kind.replace("side_", "")}`}
            </p>
            <p className="font-mono text-sm tabular-nums text-fg">
              {formatChips(p.amount)}
            </p>
          </div>
          {p.eligible.length === 0 ? (
            <p className="text-xs text-fg/55">No eligible players.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {p.eligible.map((e) => {
                const isSelected = (choices[p.kind] ?? []).includes(
                  e.tournament_player_id,
                );
                return (
                  <li key={e.tournament_player_id}>
                    <button
                      type="button"
                      onClick={() => toggle(p.kind, e.tournament_player_id)}
                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${
                        isSelected
                          ? "border-gold bg-gold/10 text-fg"
                          : "border-fg/15 text-fg/80"
                      }`}
                    >
                      <span
                        className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] ${
                          isSelected
                            ? "border-gold bg-gold text-bg"
                            : "border-fg/40 text-fg/0"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="flex-1 truncate">{e.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {(choices[p.kind]?.length ?? 0) > 1 ? (
            <p className="text-[10px] uppercase tracking-widest text-fg/55">
              Split — remainder rounds to first winner
            </p>
          ) : null}
        </div>
      ))}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={cancel}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-danger/40 text-xs font-semibold uppercase tracking-wider text-danger disabled:opacity-50"
        >
          Cancel hand
        </button>
        <button
          type="button"
          disabled={pending || !allChosen || pots.length === 0}
          onClick={award}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "Awarding…" : "Award pot"}
        </button>
      </div>
    </section>
  );
}
