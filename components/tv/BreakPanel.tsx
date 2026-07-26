import RecapSlideshow from "@/components/tv/RecapSlideshow";
import TableLeaders from "@/components/tv/TableLeaders";
import type { TableStats } from "@/lib/admin/tables";
import { formatBlinds, formatMMSS } from "@/lib/tv/format";
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

type Props = {
  remainingSec: number;
  level: BlindLevelEntry;
  nextLevel: BlindLevelEntry | null;
  /** Full level list — used to label "L4" / "B2" instead of raw level_num. */
  levels: BlindLevelEntry[];
  /** Bust/rebuy/addon events since the last break boundary, newest first. */
  lastSegmentEvents: SegmentEvent[];
  /** Per-table top-3 chip stacks, for the "Table Leaders" slide. */
  tableStats: TableStats[];
  bigBlind?: number;
};

/**
 * Break-time display: the countdown clock and next-level header stay put
 * (players need the remaining time visible at all times), but the lower
 * content area rotates between two slides via <RecapSlideshow> — the
 * per-table top-3 chip leaderboard, and a plain-English list of what
 * happened in the segment that just ended (busts/rebuys/add-ons). As soon
 * as the admin advances off the break level, <TvDisplay> stops rendering
 * this component entirely and falls back to the normal <ClockRing>.
 */
export default function BreakPanel({
  remainingSec,
  level,
  nextLevel,
  levels,
  lastSegmentEvents,
  tableStats,
  bigBlind,
}: Props) {
  const colorUp = level.color_up_chips ?? [];
  const activeTables = tableStats.filter((s) => s.activePlayers > 0);

  const slides = [
    activeTables.length > 1
      ? {
          key: "table-leaders",
          label: "Table Leaders",
          content: (
            <div className="w-full max-w-3xl mx-auto overflow-auto">
              <TableLeaders stats={tableStats} bigBlind={bigBlind} />
            </div>
          ),
        }
      : null,
    {
      key: "last-segment",
      label: "Last Segment",
      content: <LastSegmentSlide events={lastSegmentEvents} levels={levels} />,
    },
  ].filter((s): s is NonNullable<typeof s> => s !== null);

  return (
    <div className="flex flex-col items-center justify-center text-center px-[clamp(1rem,3vw,3rem)] py-[clamp(1rem,2.5vh,2.5rem)] w-full">
      <span className="text-label uppercase tracking-[0.4em] text-[clamp(1rem,2vw,1.5rem)]">
        Break
      </span>
      <span className="font-mono text-fg leading-none tabular-nums mt-[clamp(0.5rem,1vh,1rem)] text-[clamp(4rem,18vmin,10rem)]">
        {formatMMSS(remainingSec)}
      </span>
      <span className="text-label uppercase tracking-[0.3em] text-[clamp(0.7rem,1vw,0.9rem)] mt-2">
        Remaining
      </span>

      {colorUp.length > 0 ? (
        <div className="mt-[clamp(1rem,2vh,2rem)] px-[clamp(0.75rem,1.5vw,1.5rem)] py-[clamp(0.5rem,1vh,0.75rem)] border border-gold/60 rounded-md">
          <span className="text-gold-bright uppercase tracking-[0.3em] text-[clamp(0.75rem,1.1vw,1rem)]">
            Color Up
          </span>
          <span className="ml-3 font-mono text-value text-[clamp(1rem,1.6vw,1.5rem)] tabular-nums">
            {colorUp.map((v) => `$${v}`).join(", ")} chips
          </span>
        </div>
      ) : null}

      <p className="mt-[clamp(1rem,2vh,2rem)] text-label uppercase tracking-[0.25em] text-[clamp(0.7rem,0.95vw,0.9rem)]">
        Next Level:{" "}
        <span className="font-mono text-value normal-case tracking-normal">
          {nextLevel
            ? `${formatLevelLabel(levels, nextLevel.level_num)} — ${formatBlinds(
                nextLevel.small,
                nextLevel.big,
                nextLevel.ante,
              )}`
            : "—"}
        </span>
      </p>

      <div className="mt-[clamp(0.75rem,1.5vh,1.5rem)] w-full max-w-3xl flex-1 min-h-0">
        <RecapSlideshow slides={slides} intervalSec={8} />
      </div>
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
    return <p className="text-value/60 mt-1">No bust-outs, rebuys, or add-ons.</p>;
  }
  return (
    <ul className="mt-1 flex flex-col gap-1 max-h-[40vh] overflow-auto text-left mx-auto max-w-xl">
      {events.slice(0, 12).map((e, i) => (
        <li
          key={`${e.name}-${i}`}
          className="flex items-baseline justify-between gap-3"
        >
          <span className="flex items-baseline gap-2">
            <span
              className={`uppercase tracking-wider text-sm w-[3.5rem] shrink-0 ${
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
                : (e.level != null ? formatLevelLabel(levels, e.level) : "?")}
          </span>
        </li>
      ))}
    </ul>
  );
}
