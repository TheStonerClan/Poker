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
 * Per-table chip leader + average strip for the live TV display. Hidden
 * for single-table tournaments where the tournament-wide stats already
 * cover everything. Each card uses the table's configured color so
 * players can spot their own table at a glance.
 *
 * Tables with zero active players are dropped — once everyone at a
 * table has busted out, or after a Merge consolidates them onto a
 * different table, the empty card stops cluttering the strip.
 */
export default function TableLeaders({ stats, bigBlind }: Props) {
  // Filter out tables with no active players. Two cases produce these:
  // (a) every active player at that table has busted out, and (b) Merge
  // moved them to another table. Either way the card carries no useful
  // current-state info and just makes the strip noisier.
  const active = stats.filter((s) => s.activePlayers > 0);
  if (active.length <= 1) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-[clamp(0.5rem,1vw,1rem)]">
      {active.map((s) => {
        const css = TABLE_COLOR_CSS[s.color];
        const bbCount =
          bigBlind && bigBlind > 0 && s.averageChips > 0
            ? Math.round(s.averageChips / bigBlind)
            : null;
        return (
          <div
            key={s.tableNumber}
            className="rounded-md border-2 px-[clamp(0.5rem,1vw,1rem)] py-[clamp(0.4rem,0.8vh,0.75rem)]"
            style={{
              borderColor: css.border,
              background: css.bg,
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="uppercase tracking-[0.25em] text-[clamp(0.55rem,0.85vw,0.75rem)] font-semibold truncate"
                style={{ color: css.text }}
              >
                {s.name}
              </span>
              <span className="font-mono text-fg/55 text-[clamp(0.55rem,0.8vw,0.7rem)] tabular-nums whitespace-nowrap">
                {s.activePlayers}/{s.maxSeats}
              </span>
            </div>
            <div className="mt-[clamp(0.25rem,0.5vh,0.5rem)] grid grid-cols-2 gap-[clamp(0.25rem,0.5vw,0.5rem)]">
              <Stat
                label="Avg"
                value={formatChips(s.averageChips)}
                sub={bbCount != null ? `${bbCount} BB` : null}
              />
              <Stat
                label="Leader"
                value={s.chipLeader ? s.chipLeader.name : "—"}
                sub={
                  s.chipLeader ? formatChips(s.chipLeader.chips) : null
                }
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-label uppercase tracking-[0.2em] text-[clamp(0.5rem,0.7vw,0.65rem)]">
        {label}
      </span>
      <span className="font-mono text-fg text-[clamp(0.85rem,1.2vw,1.1rem)] tabular-nums truncate">
        {value}
      </span>
      {sub ? (
        <span className="font-mono text-fg/55 text-[clamp(0.55rem,0.8vw,0.75rem)] tabular-nums">
          {sub}
        </span>
      ) : null}
    </div>
  );
}
