import TvAutoRefresh from "@/components/tv/TvAutoRefresh";
import { formatChips, formatMoney } from "@/lib/tv/format";
import type {
  TournamentPlayerWithName,
  TournamentRow,
} from "@/lib/tv/types";

type PayoutRow = {
  position: number;
  amount: number;
  player_id: string | null;
  is_chopped: boolean;
};

type Props = {
  tournament: TournamentRow;
  players: TournamentPlayerWithName[];
  payouts: PayoutRow[];
};

/**
 * Read-only recap that takes over the TV after a tournament finalizes. Shows
 * the leaderboard (with chop ties), payouts, and a few headline analytics.
 * No timer, no realtime — once the tournament is over, the page is static
 * until the next one starts. Survives for `RECAP_WINDOW_MS` (set in
 * app/tv/page.tsx) before the screen falls back to the waiting state.
 */
export default function TvRecap({ tournament, players, payouts }: Props) {
  const playerName = (id: string | null): string => {
    if (!id) return "—";
    return (
      players.find((p) => p.player_id === id)?.players?.name ?? "Unknown"
    );
  };

  // Standings: sort by finishing_position ascending. Ties (chop) get the
  // same display rank by checking is_chopped on the payout row.
  const ranked = [...players]
    .filter((p) => p.finishing_position != null)
    .sort(
      (a, b) =>
        (a.finishing_position ?? Number.POSITIVE_INFINITY) -
        (b.finishing_position ?? Number.POSITIVE_INFINITY),
    );

  const choppedPositions = new Set(
    payouts.filter((p) => p.is_chopped).map((p) => p.position),
  );
  const chopActive = choppedPositions.size > 0;

  // Headline analytics: total entries, rebuys, add-ons, prize pool.
  const totalEntries = players.length;
  const rebuys = players.filter(
    (p) => p.buyback_used && p.buyback_used_as === "rebuy",
  ).length;
  const addOns = players.filter(
    (p) => p.buyback_used && p.buyback_used_as === "addon",
  ).length;
  const totalPool = payouts.reduce((s, p) => s + p.amount, 0);

  const displayLabel = (position: number): string => {
    if (chopActive && choppedPositions.has(position)) return "1st (tied)";
    return ordinal(position);
  };

  const finishedAt = tournament.finished_at
    ? new Date(tournament.finished_at)
    : null;

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col px-[clamp(1rem,3vw,3rem)] py-[clamp(1rem,2vh,2.5rem)]">
      {/* Reload every minute so /tv flips back to the live display the
          moment a new tournament starts (and so the recap eventually
          falls out when finished_at passes the recap window). */}
      <TvAutoRefresh intervalSec={60} />
      <header className="flex flex-col items-center gap-2 text-center">
        <span className="text-gold text-label uppercase tracking-[0.4em] text-[clamp(0.75rem,1.2vw,1.1rem)] font-semibold">
          Tournament complete
        </span>
        <h1 className="font-mono text-fg text-[clamp(2.5rem,7vw,5rem)] tabular-nums">
          {chopActive ? "Chopped" : "Final results"}
        </h1>
        {finishedAt ? (
          <p className="text-fg/60 text-[clamp(0.75rem,1vw,1rem)]">
            {finishedAt.toLocaleString(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        ) : null}
      </header>

      <hr className="my-[clamp(0.75rem,2vh,2rem)] border-t border-gold/40" />

      {/* MAIN: leaderboard left, payouts right */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-[clamp(1rem,3vw,3rem)] items-start">
        {/* Leaderboard */}
        <section>
          <h2 className="text-label uppercase tracking-[0.3em] text-[clamp(0.65rem,1vw,0.85rem)] font-semibold mb-[clamp(0.5rem,1vh,1rem)]">
            Leaderboard
          </h2>
          <ul className="flex flex-col gap-[clamp(0.25rem,0.6vh,0.75rem)]">
            {ranked.map((p) => {
              const pos = p.finishing_position ?? 0;
              const payoutLine = payouts.find((x) => x.position === pos);
              const isChopped = !!payoutLine?.is_chopped;
              return (
                <li
                  key={p.id}
                  className={`flex items-baseline justify-between gap-4 rounded-md px-3 py-2 ${
                    pos === 1 || (chopActive && isChopped)
                      ? "border border-gold bg-gold/10"
                      : "border border-fg/10"
                  }`}
                >
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-[clamp(1rem,1.6vw,1.5rem)] text-gold tabular-nums w-[5ch]">
                      {displayLabel(pos)}
                    </span>
                    <span className="font-mono text-fg text-[clamp(1.1rem,1.8vw,1.75rem)]">
                      {p.players?.name ?? "—"}
                    </span>
                  </div>
                  <span className="font-mono text-fg/60 text-[clamp(0.7rem,0.95vw,0.95rem)] tabular-nums">
                    {p.busted_at_level
                      ? `out · L${p.busted_at_level}`
                      : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Payouts */}
        <section>
          <h2 className="text-label uppercase tracking-[0.3em] text-[clamp(0.65rem,1vw,0.85rem)] font-semibold mb-[clamp(0.5rem,1vh,1rem)]">
            Payouts
          </h2>
          <ul className="flex flex-col gap-[clamp(0.25rem,0.6vh,0.75rem)]">
            {payouts.map((p) => (
              <li
                key={p.position}
                className="flex items-baseline justify-between gap-4 rounded-md border border-fg/10 px-3 py-2"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[clamp(1rem,1.6vw,1.5rem)] text-gold tabular-nums w-[5ch]">
                    {displayLabel(p.position)}
                  </span>
                  <span className="font-mono text-fg text-[clamp(1.1rem,1.8vw,1.75rem)]">
                    {playerName(p.player_id)}
                  </span>
                </div>
                <span className="font-mono text-value text-[clamp(1.1rem,1.8vw,1.75rem)] tabular-nums">
                  {formatMoney(p.amount)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-[clamp(0.75rem,1.5vh,1.5rem)] flex items-baseline justify-between border-t border-gold/30 pt-3">
            <span className="text-label uppercase tracking-[0.25em] text-[clamp(0.7rem,1vw,0.9rem)]">
              Prize pool
            </span>
            <span className="font-mono text-fg text-[clamp(1.25rem,2vw,2rem)] tabular-nums">
              {formatMoney(totalPool)}
            </span>
          </div>
        </section>
      </main>

      <hr className="mt-[clamp(0.75rem,2vh,2rem)] border-t border-gold/40" />

      {/* FOOTER: headline analytics */}
      <footer className="grid grid-cols-3 gap-[clamp(1rem,2vw,2rem)] py-[clamp(0.5rem,1.5vh,1.5rem)]">
        <Stat label="Entries" value={formatChips(totalEntries)} />
        <Stat label="Re-entries" value={formatChips(rebuys)} />
        <Stat label="Add-ons" value={formatChips(addOns)} />
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="text-label uppercase tracking-[0.25em] text-[clamp(0.6rem,0.9vw,0.85rem)]">
        {label}
      </span>
      <span className="font-mono text-fg text-[clamp(1.5rem,2.5vw,2.5rem)] tabular-nums mt-1">
        {value}
      </span>
    </div>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  const suffix =
    v >= 11 && v <= 13
      ? "th"
      : (["th", "st", "nd", "rd", "th"][Math.min(n % 10, 4)] ?? "th");
  return `${n}${suffix}`;
}
