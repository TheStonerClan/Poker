import { TABLE_COLOR_CSS, type TableStats } from "@/lib/admin/tables";
import { formatChips } from "@/lib/tv/format";

type Props = {
  stats: TableStats[];
  /**
   * Optional; if provided, average chips also show "X BB" alongside the
   * absolute value. Matches the tournament-wide StackStats convention.
   */
  bigBlind?: number;
};

/**
 * Per-table top-3 chip leaderboard for the live TV display. Lives in the
 * right column stacked under <PrizePool> — a vertical list of cards (one
 * per table) rather than a horizontal strip, so each card has room to
 * show 3 ranked stacks instead of just the single leader. Hidden for
 * single-table tournaments where the tournament-wide stats in the footer
 * already cover everything.
 *
 * Tables with zero active players are dropped — once everyone at a
 * table has busted out, or after a Merge consolidates them onto a
 * different table, the empty card stops cluttering the strip.
 */
export default function TableLeaders({ stats, bigBlind }: Props) {
  const active = stats.filter((s) => s.activePlayers > 0);
  if (active.length <= 1) return null;

  return (
    <div className="flex flex-col gap-[clamp(0.4rem,1vh,0.75rem)] w-full">
      {active.map((s) => {
        const css = TABLE_COLOR_CSS[s.color];
        const bbCount =
          bigBlind && bigBlind > 0 && s.averageChips > 0
            ? Math.round(s.averageChips / bigBlind)
            : null;
        return (
          <div
            key={s.tableNumber}
            className="rounded-md border-2 px-[clamp(0.6rem,1vw,1rem)] py-[clamp(0.4rem,0.8vh,0.75rem)]"
            style={{
              borderColor: css.border,
              background: css.bg,
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="uppercase tracking-[0.25em] text-[clamp(0.6rem,0.9vw,0.8rem)] font-semibold truncate"
                style={{ color: css.text }}
              >
                {s.name}
              </span>
              <span className="font-mono text-fg/55 text-[clamp(0.55rem,0.8vw,0.7rem)] tabular-nums whitespace-nowrap">
                {s.activePlayers}/{s.maxSeats} · avg {formatChips(s.averageChips)}
                {bbCount != null ? ` (${bbCount} BB)` : ""}
              </span>
            </div>
            <ol className="mt-[clamp(0.3rem,0.6vh,0.6rem)] flex flex-col gap-[clamp(0.15rem,0.3vh,0.3rem)]">
              {s.chipLeaders.length === 0 ? (
                <li className="text-fg/40 text-[clamp(0.65rem,0.9vw,0.8rem)]">—</li>
              ) : (
                s.chipLeaders.map((leader, i) => (
                  <li
                    key={leader.playerId || i}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="flex items-baseline gap-1.5 min-w-0">
                      <span className="text-label text-[clamp(0.55rem,0.75vw,0.7rem)] tabular-nums w-3 shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-fg text-[clamp(0.7rem,1vw,0.9rem)] truncate">
                        {leader.name}
                      </span>
                    </span>
                    <span className="font-mono text-value text-[clamp(0.7rem,1vw,0.9rem)] tabular-nums whitespace-nowrap">
                      {formatChips(leader.chips)}
                    </span>
                  </li>
                ))
              )}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
