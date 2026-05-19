"use client";

import { useState, useTransition } from "react";

import {
  advanceStreetManually,
  cancelHand,
  postAction,
  undoLastAction,
} from "@/app/admin/tournaments/[id]/hand-actions";
import { formatChips } from "@/lib/admin/format";
import type { ActionKind, Street } from "@/lib/admin/hand";

export type SeatRow = {
  seat_number: number;
  tournament_player_id: string;
  name: string;
  starting_chips: number;
  current_chips: number;
  total_contributed: number;
  contributed_this_street: number;
  is_folded: boolean;
  is_all_in: boolean;
  is_dealer: boolean;
  is_sb: boolean;
  is_bb: boolean;
  is_next_to_act: boolean;
};

type Props = {
  handId: string;
  handNumber: number;
  tournamentId: string;
  tableNumber: number;
  level: {
    level_num: number;
    small_blind: number;
    big_blind: number;
    ante: number;
    is_break: boolean;
  };
  currentStreet: Street;
  streets: Street[];
  pot: number;
  currentBet: number;
  nextToActSeat: number | null;
  seats: SeatRow[];
  streetIsComplete: boolean;
};

/**
 * Live action panel for an in-progress hand. The page server-side
 * computes the derived state (whose turn, current bet, per-seat
 * contribution this street, etc.) and hands it down as plain props
 * so this component just renders + dispatches actions.
 *
 * Buttons gate on the next-to-act seat: when you tap one, we send
 * `postAction` with the seat number and let the server validate.
 */
export function LiveHandPanel({
  handId,
  handNumber,
  level,
  currentStreet,
  streets,
  pot,
  currentBet,
  nextToActSeat,
  seats,
  streetIsComplete,
}: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [betValue, setBetValue] = useState<string>("");
  const [raiseValue, setRaiseValue] = useState<string>("");
  const [betMode, setBetMode] = useState<"none" | "bet" | "raise">("none");

  const activeSeat = seats.find((s) => s.seat_number === nextToActSeat);
  const owedToCall = activeSeat
    ? Math.max(0, currentBet - activeSeat.contributed_this_street)
    : 0;

  function fire(action: ActionKind, amount?: number) {
    if (!activeSeat) return;
    setError(null);
    setBetMode("none");
    setBetValue("");
    setRaiseValue("");
    start(async () => {
      const res = await postAction({
        handId,
        seatNumber: activeSeat.seat_number,
        action,
        amount,
      });
      if (!res.ok) setError(res.error);
    });
  }

  function fireUndo() {
    setError(null);
    start(async () => {
      const res = await undoLastAction({ handId });
      if (!res.ok) setError(res.error);
    });
  }

  function fireCancel() {
    if (
      !confirm(
        "Cancel this hand? Chip stacks won't change. Use for misclicks or to reset dealer.",
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

  function fireAdvance() {
    setError(null);
    start(async () => {
      const res = await advanceStreetManually({ handId });
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-lg border border-gold/40 bg-gold/5 p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Hand #{handNumber} · {currentStreet}
          </p>
          <p className="text-[10px] uppercase tracking-widest text-fg/55">
            L{level.level_num} · {formatChips(level.small_blind)}/
            {formatChips(level.big_blind)}
            {level.ante > 0 ? ` · ante ${formatChips(level.ante)}` : ""}
          </p>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <Stat label="Pot" value={formatChips(pot)} accent />
          <Stat
            label="To call"
            value={
              activeSeat
                ? owedToCall > 0
                  ? formatChips(owedToCall)
                  : "—"
                : "—"
            }
          />
        </div>
        <div className="mt-2 flex gap-1 text-[10px] uppercase tracking-widest">
          {streets.map((s) => (
            <span
              key={s}
              className={`rounded px-1.5 py-0.5 ${
                s === currentStreet
                  ? "bg-gold text-bg"
                  : "border border-fg/15 text-fg/55"
              }`}
            >
              {s}
            </span>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
          Seats
        </h2>
        <ul className="flex flex-col gap-1.5">
          {seats.map((s) => (
            <SeatRowView key={s.seat_number} seat={s} currentBet={currentBet} />
          ))}
        </ul>
      </section>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}

      {activeSeat ? (
        <section className="rounded-lg border border-fg/15 p-3">
          <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            {activeSeat.name} · seat {activeSeat.seat_number}
          </p>
          <p className="mt-1 text-xs text-fg/55">
            Stack {formatChips(activeSeat.current_chips)} · this street{" "}
            {formatChips(activeSeat.contributed_this_street)}
          </p>

          {betMode === "none" ? (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <ActionBtn
                label="Fold"
                tone="danger"
                pending={pending}
                onClick={() => fire("fold")}
              />
              {owedToCall === 0 ? (
                <ActionBtn
                  label="Check"
                  tone="neutral"
                  pending={pending}
                  onClick={() => fire("check")}
                />
              ) : (
                <ActionBtn
                  label={`Call ${formatChips(Math.min(owedToCall, activeSeat.current_chips))}`}
                  tone="neutral"
                  pending={pending}
                  onClick={() => fire("call")}
                />
              )}
              {currentBet === 0 ? (
                <ActionBtn
                  label="Bet…"
                  tone="gold"
                  pending={pending}
                  onClick={() => setBetMode("bet")}
                />
              ) : (
                <ActionBtn
                  label="Raise…"
                  tone="gold"
                  pending={pending}
                  onClick={() => setBetMode("raise")}
                />
              )}
              <ActionBtn
                label="All-in"
                tone="gold"
                pending={pending}
                onClick={() => fire("all_in")}
              />
            </div>
          ) : null}

          {betMode === "bet" ? (
            <AmountForm
              label="Bet amount"
              max={activeSeat.current_chips}
              value={betValue}
              onValueChange={setBetValue}
              onCancel={() => {
                setBetMode("none");
                setBetValue("");
              }}
              onConfirm={() => {
                const n = Number.parseInt(betValue, 10);
                if (!Number.isFinite(n) || n <= 0) return;
                fire("bet", n);
              }}
              pending={pending}
            />
          ) : null}

          {betMode === "raise" ? (
            <AmountForm
              label={`Raise to (currently ${formatChips(currentBet)})`}
              max={
                activeSeat.contributed_this_street + activeSeat.current_chips
              }
              value={raiseValue}
              onValueChange={setRaiseValue}
              onCancel={() => {
                setBetMode("none");
                setRaiseValue("");
              }}
              onConfirm={() => {
                const n = Number.parseInt(raiseValue, 10);
                if (!Number.isFinite(n) || n <= currentBet) return;
                fire("raise", n);
              }}
              pending={pending}
            />
          ) : null}
        </section>
      ) : streetIsComplete ? (
        <section className="rounded-lg border border-fg/15 p-3 text-center">
          <p className="text-sm text-fg/70">
            Betting complete on this street.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={fireAdvance}
            className="mt-2 inline-flex h-11 min-h-[44px] items-center justify-center rounded-md bg-gold px-4 text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
          >
            {pending ? "Advancing…" : "Advance street"}
          </button>
        </section>
      ) : (
        <section className="rounded-lg border border-fg/15 p-3 text-center">
          <p className="text-sm text-fg/55">
            Waiting on the table — no one is up to act right now.
          </p>
        </section>
      )}

      <section className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={fireUndo}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={fireCancel}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-danger/40 text-xs font-semibold uppercase tracking-wider text-danger disabled:opacity-50"
        >
          Cancel hand
        </button>
      </section>
    </div>
  );
}

function SeatRowView({
  seat,
  currentBet,
}: {
  seat: SeatRow;
  currentBet: number;
}) {
  const positionTags: string[] = [];
  if (seat.is_dealer) positionTags.push("D");
  if (seat.is_sb) positionTags.push("SB");
  if (seat.is_bb) positionTags.push("BB");

  const stateTone = seat.is_folded
    ? "text-fg/30 line-through"
    : seat.is_all_in
      ? "text-gold"
      : seat.is_next_to_act
        ? "text-fg"
        : "text-fg/80";

  return (
    <li
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
        seat.is_next_to_act
          ? "border-gold bg-gold/5"
          : "border-fg/10"
      }`}
    >
      <span className="w-6 text-right font-mono text-xs tabular-nums text-fg/55">
        {seat.seat_number}
      </span>
      <span className={`min-w-0 flex-1 truncate ${stateTone}`}>
        {seat.name}
      </span>
      {positionTags.length > 0 ? (
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
          {positionTags.join(" · ")}
        </span>
      ) : null}
      <span className="font-mono text-xs tabular-nums text-fg/70">
        {formatChips(seat.current_chips)}
      </span>
      {seat.contributed_this_street > 0 ? (
        <span
          className={`font-mono text-xs tabular-nums ${
            seat.contributed_this_street === currentBet && currentBet > 0
              ? "text-success"
              : "text-fg/55"
          }`}
        >
          +{formatChips(seat.contributed_this_street)}
        </span>
      ) : null}
    </li>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-md px-3 py-2 ${
        accent ? "border border-gold/40 bg-gold/10" : "border border-fg/10"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
        {label}
      </p>
      <p
        className={`mt-0.5 font-mono text-xl tabular-nums ${
          accent ? "text-gold" : "text-fg"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ActionBtn({
  label,
  tone,
  pending,
  onClick,
}: {
  label: string;
  tone: "danger" | "neutral" | "gold";
  pending: boolean;
  onClick: () => void;
}) {
  const styles = {
    danger: "border border-danger/60 text-danger",
    neutral: "border border-fg/15 text-fg/80",
    gold: "bg-gold text-bg",
  }[tone];
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onClick}
      className={`h-11 min-h-[44px] rounded-md px-3 text-xs font-semibold uppercase tracking-wider disabled:opacity-50 ${styles}`}
    >
      {pending ? "…" : label}
    </button>
  );
}

function AmountForm({
  label,
  max,
  value,
  onValueChange,
  onCancel,
  onConfirm,
  pending,
}: {
  label: string;
  max: number;
  value: string;
  onValueChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-fg/15 bg-fg/[0.02] p-3">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-fg/55">
          {label}
          <span className="ml-1 normal-case tracking-normal text-fg/40">
            max {formatChips(max)}
          </span>
        </span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={value}
          autoFocus
          onChange={(e) => onValueChange(e.target.value)}
          className="min-h-[44px] rounded-md border border-fg/15 bg-bg px-2 text-base text-fg focus:border-gold focus:outline-none"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="h-11 min-h-[44px] flex-1 rounded-md border border-fg/15 text-xs font-semibold uppercase tracking-wider text-fg/80 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending || !value}
          onClick={onConfirm}
          className="h-11 min-h-[44px] flex-1 rounded-md bg-gold text-xs font-semibold uppercase tracking-wider text-bg disabled:opacity-50"
        >
          {pending ? "…" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
