import TvAutoRefresh from "@/components/tv/TvAutoRefresh";
import { groupByTable } from "@/lib/admin/tables";
import type {
  TournamentPlayerWithName,
  TournamentRow,
} from "@/lib/tv/types";

type Props = {
  tournament: TournamentRow;
  players: TournamentPlayerWithName[];
};

/**
 * Pre-game TV view shown while a tournament is in `scheduled` state. Lists
 * every table with the players assigned to it (post-randomization), so
 * walk-ins can see where they're sitting at a glance.
 *
 * Auto-refreshes every 30s — the admin can re-randomize from the live
 * page, and the TV picks that up on the next reload. The same auto-refresh
 * is what flips the screen to <TvDisplay> when the admin advances out of
 * scheduled (status becomes `running`), since /tv re-evaluates which view
 * to render on every full request.
 */
export default function TvPregame({ tournament, players }: Props) {
  const numTables = tournament.num_tables ?? 1;
  const grouped = groupByTable(
    players.map((p) => ({
      ...p,
      // Cast strings to whatever the underlying row uses; the helper just
      // groups by table_number numeric.
    })),
    numTables,
  );

  // Sort each table by seat_number ascending so the TV layout reads like
  // the physical table.
  const ordered = Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([tableNum, rows]) => ({
      tableNum,
      rows: [...rows].sort(
        (a, b) =>
          (a.seat_number ?? Number.POSITIVE_INFINITY) -
          (b.seat_number ?? Number.POSITIVE_INFINITY),
      ),
    }));

  // Layout: 1 table → centered card; 2 → side-by-side; 3+ → grid.
  const cols =
    numTables === 1 ? "grid-cols-1" : numTables === 2 ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-3";

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col px-[clamp(1rem,3vw,3rem)] py-[clamp(1rem,2vh,2.5rem)]">
      {/* Reload every 30s so the screen flips to <TvDisplay> as soon as
          the admin advances out of `scheduled` (status -> running). */}
      <TvAutoRefresh intervalSec={30} />

      <header className="flex flex-col items-center gap-1 text-center">
        <span className="text-gold text-label uppercase tracking-[0.4em] text-[clamp(0.75rem,1.2vw,1.1rem)] font-semibold">
          Find your seat
        </span>
        <h1 className="font-mono text-fg text-[clamp(2rem,6vw,4.5rem)] tabular-nums">
          {ordered.length} table{ordered.length === 1 ? "" : "s"} · {players.length} player
          {players.length === 1 ? "" : "s"}
        </h1>
        <p className="text-fg/60 text-[clamp(0.75rem,1vw,1rem)]">
          Cards in the air when the admin starts the timer.
        </p>
      </header>

      <hr className="my-[clamp(0.75rem,2vh,2rem)] border-t border-gold/40" />

      <main className={`flex-1 grid ${cols} gap-[clamp(1rem,2vw,2rem)]`}>
        {ordered.map(({ tableNum, rows }) => (
          <section
            key={tableNum}
            className="rounded-lg border border-gold/40 bg-bg/40 p-[clamp(0.75rem,1.5vw,1.5rem)]"
          >
            <header className="flex items-baseline justify-between border-b border-gold/30 pb-[clamp(0.5rem,1vh,1rem)]">
              <h2 className="text-gold uppercase tracking-[0.3em] text-[clamp(0.85rem,1.4vw,1.25rem)] font-semibold">
                Table {tableNum}
              </h2>
              <span className="font-mono text-fg/60 text-[clamp(0.7rem,0.95vw,0.95rem)] tabular-nums">
                {rows.length} seated
              </span>
            </header>
            {rows.length === 0 ? (
              <p className="mt-[clamp(0.5rem,1vh,1rem)] text-fg/40 text-[clamp(0.85rem,1.2vw,1rem)] italic">
                No players assigned.
              </p>
            ) : (
              <ul className="mt-[clamp(0.5rem,1vh,1rem)] flex flex-col gap-[clamp(0.25rem,0.6vh,0.6rem)]">
                {rows.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-baseline justify-between gap-3 rounded-md bg-fg/[0.03] px-3 py-1.5"
                  >
                    <div className="flex items-baseline gap-3">
                      <span className="font-mono text-gold text-[clamp(0.85rem,1.2vw,1.1rem)] tabular-nums w-[3ch] text-right">
                        {p.seat_number ?? "—"}
                      </span>
                      <span className="font-mono text-fg text-[clamp(1rem,1.5vw,1.5rem)]">
                        {p.players?.name ?? "—"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}
