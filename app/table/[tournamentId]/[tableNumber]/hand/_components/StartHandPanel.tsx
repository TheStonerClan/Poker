"use client";

import { useState, useTransition } from "react";

import { startHand } from "@/app/admin/tournaments/[id]/hand-actions";
import { formatChips } from "@/lib/admin/format";

type Seat = { seat_number: number; name: string };

type Proposal =
  | { dealer_seat: number; sb_seat: number; bb_seat: number }
  | null;

type Blinds = {
  small: number;
  big: number;
  ante: number;
  level_num: number;
};

/**
 * Entry point for starting a new hand. The page server-side computes
 * the auto-rotated dealer/SB/BB proposal; this panel either confirms
 * it or lets the admin override before kicking off the hand.
 *
 * "Reset dealer" is a request to re-pick from scratch (e.g. after a
 * table merge): the override mode shows a dropdown for each of the
 * three seats so the admin can place the button wherever they want.
 */
export function StartHandPanel({
  tournamentId,
  tableNumber,
  proposal,
  activeSeats,
  blindsPreview,
  blockedReason,
}: {
  tournamentId: string;
  tableNumber: number;
  proposal: Proposal;
  activeSeats: Seat[];
  blindsPreview: Blinds | null;
  blockedReason: string | null;
}) {
  const [overriding, setOverriding] = useState(false);
  const [dealerSeat, setDealerSeat] = useState<number | null>(
    proposal?.dealer_seat ?? null,
  );
  const [sbSeat, setSbSeat] = useState<number | null>(
    proposal?.sb_seat ?? null,
  );
  const [bbSeat, setBbSeat] = useState<number | null>(
    proposal?.bb_seat ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function go(useOverride: boolean) {
    setError(null);
    start(async () => {
      const res = await startHand({
        tournamentId,
        tableNumber,
        ...(useOverride
          ? {
              dealerSeat: dealerSeat ?? undefined,
              sbSeat: sbSeat ?? undefined,
              bbSeat: bbSeat ?? undefined,
            }
          : {}),
      });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <section className="rounded-lg border border-fg/15 p-4">
      <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
        Start hand
      </h2>

      {blindsPreview ? (
        <p className="mt-2 font-mono text-sm tabular-nums text-fg/80">
          L{blindsPreview.level_num} · {formatChips(blindsPreview.small)}/
          {formatChips(blindsPreview.big)}
          {blindsPreview.ante > 0
            ? ` · ante ${formatChips(blindsPreview.ante)}`
            : ""}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="mt-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {blockedReason}
        </p>
      ) : (
        <>
          {proposal ? (
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <PositionBadge label="Dealer" seat={proposal.dealer_seat} seats={activeSeats} />
              <PositionBadge label="Small" seat={proposal.sb_seat} seats={activeSeats} />
              <PositionBadge label="Big" seat={proposal.bb_seat} seats={activeSeats} />
            </dl>
          ) : null}

          {overriding ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <SeatPicker
                label="Dealer"
                value={dealerSeat}
                seats={activeSeats}
                onChange={setDealerSeat}
              />
              <SeatPicker
                label="Small blind"
                value={sbSeat}
                seats={activeSeats}
                onChange={setSbSeat}
              />
              <SeatPicker
                label="Big blind"
                value={bbSeat}
                seats={activeSeats}
                onChange={setBbSeat}
              />
            </div>
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-danger/60 bg-danger/10 px-2 py-1.5 text-xs text-danger"
            >
              {error}
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            {overriding ? (
              <>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setOverriding(false)}
                  className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending || !dealerSeat || !sbSeat || !bbSeat}
                  onClick={() => go(true)}
                  className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
                >
                  {pending ? "Starting…" : "Start hand"}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={pending || !proposal}
                  onClick={() => setOverriding(true)}
                  className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
                >
                  Reset dealer
                </button>
                <button
                  type="button"
                  disabled={pending || !proposal}
                  onClick={() => go(false)}
                  className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
                >
                  {pending ? "Starting…" : "Start hand"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function PositionBadge({
  label,
  seat,
  seats,
}: {
  label: string;
  seat: number;
  seats: Seat[];
}) {
  const name = seats.find((s) => s.seat_number === seat)?.name ?? "—";
  return (
    <div className="rounded-md border border-fg/10 px-2 py-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-fg">
        Seat {seat}
      </p>
      <p className="truncate text-[11px] text-fg/60">{name}</p>
    </div>
  );
}

function SeatPicker({
  label,
  value,
  seats,
  onChange,
}: {
  label: string;
  value: number | null;
  seats: Seat[];
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
        {label}
      </span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-sm text-fg focus:border-gold focus:outline-none"
      >
        <option value="">—</option>
        {seats.map((s) => (
          <option key={s.seat_number} value={s.seat_number}>
            Seat {s.seat_number} · {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
