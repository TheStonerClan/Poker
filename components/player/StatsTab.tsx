"use client";

import type { PlayerHomeProps } from "./PlayerHome";

type Props = {
  player: PlayerHomeProps["player"];
  stats: PlayerHomeProps["stats"];
  optimisticBusted: boolean;
};

export function StatsTab({ player, stats, optimisticBusted }: Props) {
  const busted = optimisticBusted || Boolean(player.bustedAtTime);
  const bbsRemaining =
    !busted && stats.bigBlind && stats.bigBlind > 0
      ? Math.floor(player.currentChips / stats.bigBlind)
      : null;

  return (
    <div className="flex flex-col gap-4">
      <Card label="Chip count" value={player.currentChips.toLocaleString()}>
        {busted ? (
          <span className="text-danger">Busted L{player.bustedAtLevel ?? "—"}</span>
        ) : null}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card
          label="Position"
          value={
            busted
              ? player.finishingPosition
                ? `${ordinal(player.finishingPosition)}`
                : "—"
              : stats.myActiveRank
                ? `${ordinal(stats.myActiveRank)} of ${stats.activeCount}`
                : "—"
          }
        />
        <Card
          label="BBs"
          value={bbsRemaining !== null ? bbsRemaining.toString() : "—"}
          sub={
            stats.bigBlind && !stats.isBreak
              ? `BB ${stats.bigBlind.toLocaleString()}`
              : stats.isBreak
                ? "Break"
                : undefined
          }
        />
      </div>

      <Card
        label={busted ? "Payout" : "If busted now"}
        value={
          busted
            ? `$${(player.payoutAmount ?? 0).toLocaleString()}`
            : `$${stats.payoutIfBust.toLocaleString()}`
        }
        sub={
          busted
            ? null
            : stats.positionIfBust
              ? `as ${ordinal(stats.positionIfBust)} of ${stats.activeCount}`
              : null
        }
      />

      <Card
        label="Prize pool"
        value={`$${stats.prizePool.toLocaleString()}`}
      />

      <Card
        label="Buyback"
        value={
          player.buybackUsed
            ? `Used as ${player.buybackUsedAs ?? "?"}`
            : busted && stats.currentLevelNum <= 6
              ? "Available — see admin"
              : "Available"
        }
      />
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  children,
}: {
  label: string;
  value: string;
  sub?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gold/30 bg-bg/40 p-5">
      <p className="text-label text-xs uppercase tracking-widest">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-fg">
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-fg/50">{sub}</p> : null}
      {children}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
