import LocalDateTime from "@/components/admin/LocalDateTime";
import RecapSlideshow from "@/components/tv/RecapSlideshow";
import TvAutoRefresh from "@/components/tv/TvAutoRefresh";
import {
  biggestChipSwings,
  type ChipSnapshotEvent,
} from "@/lib/admin/chip-snapshots";
import {
  buildPlayerHistories,
  type GameEvent,
  type HistoryEntry,
} from "@/lib/admin/player-history";
import { TABLE_COLOR_CSS } from "@/lib/admin/tables";
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
  /**
   * All chip_snapshot events for the recap tournament, ascending by
   * created_at. Used to compute biggest single-break gain / loss for
   * the Stats slide. Empty array → swings hide.
   */
  chipSnapshots?: ChipSnapshotEvent[];
  /**
   * bust / rebuy / addon events for the recap tournament, ascending by
   * created_at. Used to compute per-player history timelines on the
   * Stats slide.
   */
  gameEvents?: GameEvent[];
};

/**
 * Read-only recap that takes over the TV after a tournament finalizes.
 * Header stays static (title + finished-at date + slideshow indicator);
 * a `<RecapSlideshow>` rotates between three slides every ~10s:
 *
 *   1. Leaderboard — final standings, chops labeled "1st (tied)"
 *   2. Payouts — who got paid what + total prize pool
 *   3. Stats — headline counts + biggest swings + per-player
 *      bust/rebuy/addon timeline
 *
 * Auto-refreshes every 60s (`<TvAutoRefresh>`) so when a new tournament
 * starts (or the recap window expires after 6 hours) the screen flips
 * back to the live display or waiting state.
 */
export default function TvRecap({
  tournament,
  players,
  payouts,
  chipSnapshots = [],
  gameEvents = [],
}: Props) {
  const playerName = (id: string | null): string => {
    if (!id) return "—";
    return (
      players.find((p) => p.player_id === id)?.players?.name ?? "Unknown"
    );
  };

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

  const histories = buildPlayerHistories({
    events: gameEvents,
    players,
    payouts,
  });
  const { biggestGain, biggestLoss } = biggestChipSwings(chipSnapshots);

  return (
    <div className="h-screen overflow-hidden bg-bg text-fg flex flex-col px-[clamp(1rem,3vw,3rem)] py-[clamp(0.75rem,1.5vh,2rem)]">
      <TvAutoRefresh intervalSec={60} />

      <header className="flex flex-col items-center gap-1 text-center mb-[clamp(0.5rem,1.5vh,1.5rem)]">
        <span className="text-gold text-label uppercase tracking-[0.4em] text-[clamp(0.7rem,1.1vw,1rem)] font-semibold">
          Tournament complete
        </span>
        <h1 className="font-mono text-fg text-[clamp(1.75rem,5vw,3.5rem)] tabular-nums">
          {chopActive ? "Chopped" : "Final results"}
        </h1>
        {tournament.finished_at ? (
          <p className="text-fg/60 text-[clamp(0.7rem,0.9vw,0.95rem)]">
            <LocalDateTime
              iso={tournament.finished_at}
              options={{
                weekday: "long",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }}
            />
          </p>
        ) : null}
      </header>

      <RecapSlideshow
        intervalSec={10}
        slides={[
          {
            key: "leaderboard",
            label: "Leaderboard",
            content: (
              <LeaderboardSlide
                ranked={ranked}
                payouts={payouts}
                chopActive={chopActive}
                displayLabel={displayLabel}
              />
            ),
          },
          {
            key: "payouts",
            label: "Payouts",
            content: (
              <PayoutsSlide
                payouts={payouts}
                playerName={playerName}
                displayLabel={displayLabel}
                totalPool={totalPool}
              />
            ),
          },
          {
            key: "stats",
            label: "Stats",
            content: (
              <StatsSlide
                histories={histories}
                totalEntries={totalEntries}
                rebuys={rebuys}
                addOns={addOns}
                biggestGain={biggestGain}
                biggestLoss={biggestLoss}
                playerName={playerName}
                chopActive={chopActive}
                choppedPositions={choppedPositions}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

// ─── Leaderboard slide ─────────────────────────────────────────────────────

function LeaderboardSlide({
  ranked,
  payouts,
  chopActive,
  displayLabel,
}: {
  ranked: TournamentPlayerWithName[];
  payouts: PayoutRow[];
  chopActive: boolean;
  displayLabel: (n: number) => string;
}) {
  return (
    <ul className="flex-1 overflow-auto flex flex-col gap-[clamp(0.25rem,0.6vh,0.6rem)]">
      {ranked.map((p) => {
        const pos = p.finishing_position ?? 0;
        const payoutLine = payouts.find((x) => x.position === pos);
        const isChopped = !!payoutLine?.is_chopped;
        const winnerHighlight = pos === 1 || (chopActive && isChopped);
        return (
          <li
            key={p.id}
            className={`flex items-baseline justify-between gap-4 rounded-md px-4 py-2.5 ${
              winnerHighlight
                ? "border border-gold bg-gold/10"
                : "border border-fg/10"
            }`}
          >
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="font-mono text-[clamp(1rem,1.5vw,1.4rem)] text-gold tabular-nums w-[6ch]">
                {displayLabel(pos)}
              </span>
              <span className="font-mono text-fg text-[clamp(1rem,1.6vw,1.6rem)] truncate">
                {p.players?.name ?? "—"}
              </span>
            </div>
            <span className="font-mono text-fg/60 text-[clamp(0.7rem,0.9vw,0.9rem)] tabular-nums whitespace-nowrap">
              {p.busted_at_level ? `out · L${p.busted_at_level}` : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ─── Payouts slide ─────────────────────────────────────────────────────────

function PayoutsSlide({
  payouts,
  playerName,
  displayLabel,
  totalPool,
}: {
  payouts: PayoutRow[];
  playerName: (id: string | null) => string;
  displayLabel: (n: number) => string;
  totalPool: number;
}) {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <ul className="flex-1 overflow-auto flex flex-col gap-[clamp(0.25rem,0.6vh,0.6rem)]">
        {payouts.map((p) => (
          <li
            key={p.position}
            className="flex items-baseline justify-between gap-4 rounded-md border border-fg/10 px-4 py-2.5"
          >
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="font-mono text-[clamp(1rem,1.5vw,1.4rem)] text-gold tabular-nums w-[6ch]">
                {displayLabel(p.position)}
              </span>
              <span className="font-mono text-fg text-[clamp(1rem,1.6vw,1.6rem)] truncate">
                {playerName(p.player_id)}
              </span>
            </div>
            <span className="font-mono text-value text-[clamp(1.1rem,1.7vw,1.6rem)] tabular-nums">
              {formatMoney(p.amount)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-[clamp(0.5rem,1vh,1rem)] flex items-baseline justify-between border-t border-gold/30 pt-3">
        <span className="text-label uppercase tracking-[0.25em] text-[clamp(0.7rem,0.9vw,0.85rem)]">
          Prize pool
        </span>
        <span className="font-mono text-fg text-[clamp(1.1rem,1.8vw,1.75rem)] tabular-nums">
          {formatMoney(totalPool)}
        </span>
      </div>
    </div>
  );
}

// ─── Stats slide ───────────────────────────────────────────────────────────

function StatsSlide({
  histories,
  totalEntries,
  rebuys,
  addOns,
  biggestGain,
  biggestLoss,
  playerName,
  chopActive,
  choppedPositions,
}: {
  histories: ReturnType<typeof buildPlayerHistories>;
  totalEntries: number;
  rebuys: number;
  addOns: number;
  biggestGain: ReturnType<typeof biggestChipSwings>["biggestGain"];
  biggestLoss: ReturnType<typeof biggestChipSwings>["biggestLoss"];
  playerName: (id: string | null) => string;
  chopActive: boolean;
  choppedPositions: Set<number>;
}) {
  return (
    <div className="flex flex-1 flex-col min-h-0 gap-[clamp(0.5rem,1vh,1rem)]">
      {/* Headline counts */}
      <div className="grid grid-cols-3 gap-[clamp(0.5rem,1vw,1rem)]">
        <Stat label="Entries" value={formatChips(totalEntries)} />
        <Stat label="Re-entries" value={formatChips(rebuys)} />
        <Stat label="Add-ons" value={formatChips(addOns)} />
      </div>

      {/* Biggest swings — only render if any chip snapshots existed */}
      {biggestGain || biggestLoss ? (
        <div className="grid grid-cols-2 gap-[clamp(0.5rem,1vw,1rem)]">
          <SwingCard
            tone="gain"
            label="Biggest gain"
            playerName={biggestGain ? playerName(biggestGain.playerId) : null}
            delta={biggestGain?.delta ?? null}
            level={biggestGain?.levelNum ?? null}
          />
          <SwingCard
            tone="loss"
            label="Biggest loss"
            playerName={biggestLoss ? playerName(biggestLoss.playerId) : null}
            delta={biggestLoss?.delta ?? null}
            level={biggestLoss?.levelNum ?? null}
          />
        </div>
      ) : null}

      {/* Per-player timelines — scroll if too tall */}
      <ul className="flex-1 min-h-0 overflow-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[clamp(0.5rem,1vh,0.75rem)]">
        {histories.map((h) => {
          const pos = h.finalPosition ?? 0;
          const tied = chopActive && pos > 0 && choppedPositions.has(pos);
          return (
            <li
              key={h.playerId}
              className="rounded-md border border-fg/10 bg-fg/[0.02] px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-fg text-[clamp(0.9rem,1.2vw,1.1rem)] truncate">
                  {h.name}
                </span>
                <span className="text-gold font-mono text-[clamp(0.7rem,0.95vw,0.95rem)] tabular-nums whitespace-nowrap">
                  {tied
                    ? "1st (tied)"
                    : pos > 0
                      ? ordinal(pos)
                      : "—"}
                </span>
              </div>
              {h.events.length === 0 ? (
                <p className="mt-1 text-fg/40 text-[clamp(0.7rem,0.9vw,0.85rem)] italic">
                  No bust / rebuy events.
                </p>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {h.events.map((e, i) => (
                    <HistoryRow key={i} entry={e} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const tone =
    entry.type === "bust"
      ? "text-danger"
      : entry.type === "rebuy"
        ? "text-success"
        : "text-gold";
  const label =
    entry.type === "bust"
      ? "Bust"
      : entry.type === "rebuy"
        ? "Rebuy"
        : "Add-on";
  return (
    <li className="flex items-baseline gap-2 text-[clamp(0.7rem,0.9vw,0.85rem)] font-mono">
      <span className={`uppercase tracking-wider w-[3.5rem] ${tone}`}>
        {label}
      </span>
      <span className="text-fg/70 tabular-nums w-[2.5rem]">
        L{entry.level ?? "?"}
      </span>
      <span className="text-fg/55 tabular-nums">
        {formatHourMinute(entry.at)}
      </span>
      {entry.chips ? (
        <span className="text-fg/40 tabular-nums">
          (+{entry.chips.toLocaleString()})
        </span>
      ) : null}
    </li>
  );
}

function formatHourMinute(iso: string): string {
  // Server-safe HH:MM in the server's TZ. The /tv route is force-dynamic
  // so on Vercel this is UTC — acceptable for a recap that's shown in a
  // local poker room where everyone knows when the night was. Could be
  // wrapped in a client component later if local-TZ fidelity matters.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ─── Small primitives ──────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-fg/10 px-3 py-2 text-center">
      <span className="text-label uppercase tracking-[0.25em] text-[clamp(0.55rem,0.85vw,0.75rem)]">
        {label}
      </span>
      <p className="font-mono text-fg text-[clamp(1.1rem,1.7vw,1.6rem)] tabular-nums mt-0.5">
        {value}
      </p>
    </div>
  );
}

function SwingCard({
  tone,
  label,
  playerName,
  delta,
  level,
}: {
  tone: "gain" | "loss";
  label: string;
  playerName: string | null;
  delta: number | null;
  level: number | null;
}) {
  const css =
    tone === "gain" ? TABLE_COLOR_CSS.green : TABLE_COLOR_CSS.red;
  if (delta == null || playerName == null) {
    return (
      <div className="rounded-md border border-fg/10 px-3 py-2 text-fg/40">
        <span className="text-label uppercase tracking-[0.25em] text-[clamp(0.55rem,0.85vw,0.75rem)]">
          {label}
        </span>
        <p className="text-[clamp(0.85rem,1.1vw,1rem)] mt-0.5">No reports.</p>
      </div>
    );
  }
  return (
    <div
      className="rounded-md border-2 px-3 py-2"
      style={{ borderColor: css.border, background: css.bg }}
    >
      <span
        className="text-label uppercase tracking-[0.25em] text-[clamp(0.55rem,0.85vw,0.75rem)]"
        style={{ color: css.text }}
      >
        {label}
      </span>
      <p className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-fg text-[clamp(0.9rem,1.3vw,1.2rem)] truncate">
          {playerName}
        </span>
        <span
          className="font-mono tabular-nums text-[clamp(1rem,1.5vw,1.4rem)]"
          style={{ color: css.text }}
        >
          {delta > 0 ? "+" : ""}
          {delta.toLocaleString()}
        </span>
      </p>
      {level != null ? (
        <p className="mt-0.5 text-[clamp(0.65rem,0.85vw,0.8rem)] text-fg/55">
          at L{level}
        </p>
      ) : null}
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
