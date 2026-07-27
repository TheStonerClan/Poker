import { TABLE_COLOR_CSS, type TableColor } from "@/lib/admin/tables";
import { formatChips } from "@/lib/tv/format";

type Row = { playerId: string; name: string; chips: number };

type Props = {
  tableName: string;
  color: TableColor;
  /** Every active player at the table, sorted by chips descending. */
  rows: Row[];
};

/**
 * Once the field is down to one active table — a Merge, or a
 * tournament that only ever had one — <TableLeaders>'s per-table strip
 * hides itself (nothing to compare across tables). Rather than lose the
 * leaderboard entirely, show the FULL final-table roster (max 9 seats)
 * instead of just a top-3: the right column has the vertical room for
 * it once it's not sharing space with other tables' cards.
 */
export default function FinalTableLeaderboard({ tableName, color, rows }: Props) {
  if (rows.length === 0) return null;
  const css = TABLE_COLOR_CSS[color];
  return (
    <div
      className="w-full rounded-md border-2 px-[clamp(0.6rem,1vw,1rem)] py-[clamp(0.5rem,1vh,0.85rem)]"
      style={{ borderColor: css.border, background: css.bg }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          className="uppercase tracking-[0.25em] text-[clamp(0.6rem,0.9vw,0.8rem)] font-semibold"
          style={{ color: css.text }}
        >
          {tableName}
        </span>
        <span className="font-mono text-fg/55 text-[clamp(0.55rem,0.8vw,0.7rem)] tabular-nums whitespace-nowrap">
          Final table
        </span>
      </div>
      <ol className="mt-[clamp(0.35rem,0.7vh,0.7rem)] flex flex-col gap-[clamp(0.2rem,0.45vh,0.45rem)]">
        {rows.map((r, i) => (
          <li
            key={r.playerId || i}
            className="flex items-baseline justify-between gap-2"
          >
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-label text-[clamp(0.55rem,0.75vw,0.7rem)] tabular-nums w-3 shrink-0">
                {i + 1}
              </span>
              <span className="text-fg text-[clamp(0.75rem,1.05vw,0.95rem)] truncate">
                {r.name}
              </span>
            </span>
            <span className="font-mono text-value text-[clamp(0.75rem,1.05vw,0.95rem)] tabular-nums whitespace-nowrap">
              {formatChips(r.chips)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
