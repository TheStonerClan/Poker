import TvAutoRefresh from "@/components/tv/TvAutoRefresh";
import {
  groupByTable,
  resolveTablesConfig,
  TABLE_COLOR_CSS,
} from "@/lib/admin/tables";
import type {
  TournamentPlayerWithName,
  TournamentRow,
} from "@/lib/tv/types";

type Props = {
  tournament: TournamentRow;
  players: TournamentPlayerWithName[];
};

/**
 * Pre-game TV view shown while a tournament is in `scheduled` state.
 * Each table is rendered as a colored card titled with its admin-set
 * name, players sorted by seat. Walk-ins use the color + name to find
 * their seat at a glance — "I'm at the green Felt table, seat 3".
 *
 * Auto-refreshes every 30s — the admin can re-randomize from the live
 * page, and the TV picks that up on the next reload. The same
 * auto-refresh flips the screen to <TvDisplay> when the admin advances
 * out of `scheduled` (status -> running), since /tv re-evaluates which
 * view to render on every full request.
 */
export default function TvPregame({ tournament, players }: Props) {
  const tables = resolveTablesConfig({
    tablesConfig: tournament.tables_config,
    numTables: tournament.num_tables,
    maxSeatsPerTable: tournament.max_seats_per_table,
  });
  const numTables = tables.length || 1;
  const grouped = groupByTable(
    players.map((p) => ({ ...p })),
    numTables,
  );

  const ordered = Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([tableNum, rows]) => ({
      tableNum,
      cfg: tables[tableNum - 1] ?? null,
      rows: [...rows].sort(
        (a, b) =>
          (a.seat_number ?? Number.POSITIVE_INFINITY) -
          (b.seat_number ?? Number.POSITIVE_INFINITY),
      ),
    }));

  const cols =
    ordered.length === 1
      ? "grid-cols-1"
      : ordered.length === 2
        ? "grid-cols-2"
        : "grid-cols-2 lg:grid-cols-3";

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
          {ordered.length} table{ordered.length === 1 ? "" : "s"} ·{" "}
          {players.length} player{players.length === 1 ? "" : "s"}
        </h1>
        <p className="text-fg/60 text-[clamp(0.75rem,1vw,1rem)]">
          Cards in the air when the admin starts the timer.
        </p>
      </header>

      <hr className="my-[clamp(0.75rem,2vh,2rem)] border-t border-gold/40" />

      <main className={`flex-1 grid ${cols} gap-[clamp(1rem,2vw,2rem)]`}>
        {ordered.map(({ tableNum, cfg, rows }) => {
          const css = cfg ? TABLE_COLOR_CSS[cfg.color] : TABLE_COLOR_CSS.gold;
          const name = cfg?.name ?? `Table ${tableNum}`;
          const cap = cfg?.max_seats ?? rows.length;
          return (
            <section
              key={tableNum}
              className="rounded-lg border-2 p-[clamp(0.75rem,1.5vw,1.5rem)]"
              style={{
                borderColor: css.border,
                background: css.bg,
              }}
            >
              <header
                className="flex items-baseline justify-between border-b pb-[clamp(0.5rem,1vh,1rem)]"
                style={{ borderColor: css.border }}
              >
                <h2
                  className="uppercase tracking-[0.3em] text-[clamp(0.95rem,1.6vw,1.4rem)] font-semibold"
                  style={{ color: css.text }}
                >
                  {name}
                </h2>
                <span className="font-mono text-fg/60 text-[clamp(0.7rem,0.95vw,0.95rem)] tabular-nums">
                  {rows.length}/{cap} seated
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
                        <span
                          className="font-mono text-[clamp(0.85rem,1.2vw,1.1rem)] tabular-nums w-[3ch] text-right"
                          style={{ color: css.text }}
                        >
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
          );
        })}
      </main>
    </div>
  );
}
