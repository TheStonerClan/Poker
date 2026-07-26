import { QRCodeSVG } from "qrcode.react";

import RecapSlideshow from "@/components/tv/RecapSlideshow";
import { TABLE_COLOR_CSS, type TableColor } from "@/lib/admin/tables";
import { formatBlinds, formatChips, formatMMSS } from "@/lib/tv/format";
import { formatLevelLabel } from "@/lib/tv/levels";
import type { BlindLevelEntry } from "@/lib/tv/types";

export type SegmentEvent = {
  type: "bust" | "rebuy" | "addon";
  name: string;
  level: number | null;
  /** Only set for type "bust" — did they buy back in since? */
  rebought?: boolean;
  /** Only set for type "rebuy" | "addon" — chips added. */
  chips?: number | null;
};

export type LeaderboardRow = { playerId: string; name: string; chips: number };
export type TableLeaderboard = {
  tableNumber: number;
  name: string;
  color: TableColor;
  rows: LeaderboardRow[];
};

type Props = {
  remainingSec: number;
  level: BlindLevelEntry;
  nextLevel: BlindLevelEntry | null;
  /** Full level list — used to label "L4" / "B2" instead of raw level_num. */
  levels: BlindLevelEntry[];
  /** Every active player tournament-wide, sorted by chips descending. */
  overallLeaderboard: LeaderboardRow[];
  /** Every active player, grouped and sorted per table. */
  perTableLeaderboards: TableLeaderboard[];
  /** Bust/rebuy/addon events since the last break boundary, newest first. */
  lastSegmentEvents: SegmentEvent[];
  qrValue: string;
};

/**
 * Full-screen takeover for the break. Replaces <TvDisplay>'s entire
 * layout (not just the middle column) — the per-table top-3 strip that
 * lives in the normal right column during play is too cramped to be
 * useful as a "look at this" moment, so break time gets the whole
 * screen instead: the countdown stays put up top, and a slideshow below
 * rotates the full (not top-3) chip standings — tournament-wide, then
 * broken out by table — followed by what happened in the segment that
 * just ended. Reverts to the normal <ClockRing> layout automatically in
 * <TvDisplay> the instant the admin advances off the break level.
 */
export default function BreakScreen({
  remainingSec,
  level,
  nextLevel,
  levels,
  overallLeaderboard,
  perTableLeaderboards,
  lastSegmentEvents,
  qrValue,
}: Props) {
  const colorUp = level.color_up_chips ?? [];

  const slides = [
    {
      key: "overall",
      label: "Chip Leaderboard",
      content: <RankedGrid rows={overallLeaderboard} />,
    },
    perTableLeaderboards.length > 1
      ? {
          key: "by-table",
          label: "By Table",
          content: <ByTableGrid tables={perTableLeaderboards} />,
        }
      : null,
    {
      key: "last-segment",
      label: "Last Segment",
      content: <LastSegmentSlide events={lastSegmentEvents} levels={levels} />,
    },
  ].filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      <header className="flex flex-col items-center text-center px-[clamp(1rem,3vw,3rem)] pt-[clamp(0.75rem,2vh,1.5rem)] pb-[clamp(0.5rem,1.5vh,1rem)]">
        <span className="text-label uppercase tracking-[0.4em] text-[clamp(0.9rem,1.6vw,1.25rem)]">
          Break
        </span>
        <span className="font-mono text-fg leading-none tabular-nums mt-1 text-[clamp(2.5rem,8vmin,4.5rem)]">
          {formatMMSS(remainingSec)}
        </span>
        <div className="mt-[clamp(0.5rem,1.5vh,1rem)] flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
          {colorUp.length > 0 ? (
            <span className="text-gold-bright uppercase tracking-[0.25em] text-[clamp(0.7rem,1vw,0.9rem)]">
              Color Up: {colorUp.map((v) => `$${v}`).join(", ")} chips
            </span>
          ) : null}
          <span className="text-label uppercase tracking-[0.2em] text-[clamp(0.7rem,1vw,0.9rem)]">
            Next:{" "}
            <span className="font-mono text-value normal-case tracking-normal">
              {nextLevel
                ? `${formatLevelLabel(levels, nextLevel.level_num)} — ${formatBlinds(
                    nextLevel.small,
                    nextLevel.big,
                    nextLevel.ante,
                  )}`
                : "—"}
            </span>
          </span>
        </div>
      </header>

      <hr className="border-t border-gold/40 mx-[clamp(0.5rem,2vw,2rem)]" />

      <main className="flex-1 min-h-0 flex flex-col px-[clamp(1rem,3vw,3rem)] py-[clamp(0.75rem,2vh,1.5rem)]">
        <RecapSlideshow slides={slides} intervalSec={10} />
      </main>

      <footer className="flex items-center justify-center gap-2 pb-[clamp(0.75rem,2vh,1.5rem)]">
        <div className="bg-white p-1.5 rounded">
          <QRCodeSVG value={qrValue} size={64} level="M" />
        </div>
        <span className="text-label uppercase tracking-[0.25em] text-[10px]">
          Scan for the player view
        </span>
      </footer>
    </div>
  );
}

function RankedGrid({ rows }: { rows: LeaderboardRow[] }) {
  if (rows.length === 0) {
    return <p className="text-fg/50 text-center mt-4">No active players.</p>;
  }
  return (
    <ul className="flex-1 min-h-0 overflow-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[clamp(0.4rem,1vh,0.6rem)] content-start">
      {rows.map((r, i) => (
        <li
          key={r.playerId || i}
          className="flex items-baseline justify-between gap-3 rounded-md border border-fg/10 px-4 py-2"
        >
          <span className="flex items-baseline gap-3 min-w-0">
            <span className="font-mono text-gold text-[clamp(0.9rem,1.3vw,1.15rem)] tabular-nums w-[2.5ch]">
              {i + 1}
            </span>
            <span className="font-mono text-fg text-[clamp(0.95rem,1.4vw,1.2rem)] truncate">
              {r.name}
            </span>
          </span>
          <span className="font-mono text-value text-[clamp(0.95rem,1.4vw,1.2rem)] tabular-nums whitespace-nowrap">
            {formatChips(r.chips)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ByTableGrid({ tables }: { tables: TableLeaderboard[] }) {
  return (
    <div className="flex-1 min-h-0 overflow-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[clamp(0.6rem,1.5vh,1rem)] content-start">
      {tables.map((t) => {
        const css = TABLE_COLOR_CSS[t.color];
        return (
          <div
            key={t.tableNumber}
            className="rounded-md border-2 px-[clamp(0.75rem,1.2vw,1.1rem)] py-[clamp(0.5rem,1vh,0.85rem)]"
            style={{ borderColor: css.border, background: css.bg }}
          >
            <p
              className="uppercase tracking-[0.25em] text-[clamp(0.65rem,0.95vw,0.85rem)] font-semibold mb-1.5"
              style={{ color: css.text }}
            >
              {t.name}
            </p>
            <ol className="flex flex-col gap-1">
              {t.rows.map((r, i) => (
                <li
                  key={r.playerId || i}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="text-label text-[clamp(0.6rem,0.85vw,0.75rem)] tabular-nums w-3 shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-fg text-[clamp(0.8rem,1.1vw,1rem)] truncate">
                      {r.name}
                    </span>
                  </span>
                  <span className="font-mono text-value text-[clamp(0.8rem,1.1vw,1rem)] tabular-nums whitespace-nowrap">
                    {formatChips(r.chips)}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

function LastSegmentSlide({
  events,
  levels,
}: {
  events: SegmentEvent[];
  levels: BlindLevelEntry[];
}) {
  if (events.length === 0) {
    return (
      <p className="text-fg/50 text-center mt-4">
        No bust-outs, rebuys, or add-ons.
      </p>
    );
  }
  return (
    <ul className="flex-1 min-h-0 overflow-auto flex flex-col gap-1.5 max-w-2xl mx-auto w-full">
      {events.slice(0, 24).map((e, i) => (
        <li
          key={`${e.name}-${i}`}
          className="flex items-baseline justify-between gap-3 rounded-md border border-fg/10 px-4 py-2"
        >
          <span className="flex items-baseline gap-3">
            <span
              className={`uppercase tracking-wider text-sm w-[4rem] shrink-0 ${
                e.type === "bust"
                  ? "text-danger"
                  : e.type === "rebuy"
                    ? "text-success"
                    : "text-gold"
              }`}
            >
              {e.type === "bust" ? "Bust" : e.type === "rebuy" ? "Rebuy" : "Add-on"}
            </span>
            <span className="text-value">{e.name}</span>
          </span>
          <span className="text-label text-sm whitespace-nowrap">
            {e.type === "bust"
              ? e.rebought
                ? "rebought"
                : e.level != null
                  ? formatLevelLabel(levels, e.level)
                  : "?"
              : e.chips
                ? `+${e.chips.toLocaleString()}`
                : e.level != null
                  ? formatLevelLabel(levels, e.level)
                  : "?"}
          </span>
        </li>
      ))}
    </ul>
  );
}
