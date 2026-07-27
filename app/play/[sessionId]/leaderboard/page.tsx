import Link from "next/link";
import { notFound } from "next/navigation";

import { SandboxBadge } from "@/components/SandboxBadge";
import { resolveTablesConfig, TABLE_COLOR_CSS, type TableColor } from "@/lib/admin/tables";
import { formatChips } from "@/lib/tv/format";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type LeaderRow = {
  name: string;
  chips: number;
  busted: boolean;
};

type LeaderboardPageProps = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Public, no-claim-needed leaderboard reachable from the TV's QR code
 * (linked off the pick-a-name screen) and from the "Leaders" tab inside a
 * claimed player session. Shows per-table standings plus an overall
 * tournament-wide ranking — the same top-3-per-table data model as the
 * TV's <TableLeaders>, but the full roster rather than just the top 3,
 * since a phone screen has room to scroll.
 */
export default async function LeaderboardPage({ params }: LeaderboardPageProps) {
  const { sessionId } = await params;
  const supabase = createServiceClient();

  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select(
      "id, is_sandbox, num_tables, max_seats_per_table, tables_config, template:tournament_templates(name)",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (tErr || !tournament) notFound();

  const { data: rosterRows } = await supabase
    .from("tournament_players")
    .select(
      "player_id, current_chips, table_number, busted_at_time, players!tournament_players_player_id_fkey(name)",
    )
    .eq("tournament_id", sessionId);

  const roster = (rosterRows ?? []).filter(
    (row): row is typeof row & { players: { name: string } } =>
      Boolean(row.players?.name),
  );

  const toRow = (row: (typeof roster)[number]): LeaderRow => ({
    name: row.players.name,
    chips: row.current_chips ?? 0,
    busted: Boolean(row.busted_at_time),
  });

  const sortRows = (rows: LeaderRow[]): LeaderRow[] =>
    [...rows].sort((a, b) => {
      if (a.busted !== b.busted) return a.busted ? 1 : -1;
      return b.chips - a.chips;
    });

  const overall = sortRows(roster.map(toRow));

  const tablesConfig = resolveTablesConfig({
    tablesConfig: tournament.tables_config,
    numTables: tournament.num_tables,
    maxSeatsPerTable: tournament.max_seats_per_table,
  });

  const perTable = tablesConfig
    .map((cfg, i) => {
      const tableNumber = i + 1;
      const rows = sortRows(
        roster
          .filter((r) => r.table_number === tableNumber)
          .map(toRow),
      );
      return { tableNumber, name: cfg.name, color: cfg.color, rows };
    })
    .filter((t) => t.rows.length > 0);

  const tournamentName =
    (tournament.template as { name?: string } | null)?.name ?? "Tournament";

  return (
    <main className="flex flex-1 flex-col px-5 py-6 pb-24">
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <p className="text-label text-xs uppercase tracking-widest">
            {tournamentName}
          </p>
          {tournament.is_sandbox ? <SandboxBadge /> : null}
        </div>
        <h1 className="mt-1 text-3xl font-semibold text-fg">Leaderboard</h1>
        <Link
          href={`/play/${sessionId}`}
          className="mt-2 inline-block text-sm text-fg/60 underline"
        >
          ← Back
        </Link>
      </header>

      {overall.length === 0 ? (
        <p className="text-fg/60">No players yet.</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-2 text-label text-xs uppercase tracking-widest">
              Overall
            </h2>
            <RankedList rows={overall} />
          </section>

          {perTable.length > 1
            ? perTable.map((t) => (
                <section key={t.tableNumber}>
                  <h2
                    className="mb-2 text-xs uppercase tracking-widest font-semibold"
                    style={{ color: TABLE_COLOR_CSS[t.color as TableColor].text }}
                  >
                    {t.name}
                  </h2>
                  <RankedList rows={t.rows} />
                </section>
              ))
            : null}
        </div>
      )}
    </main>
  );
}

function RankedList({ rows }: { rows: LeaderRow[] }) {
  let rank = 0;
  const ranked = rows.map((r) => ({ ...r, rank: r.busted ? null : ++rank }));
  return (
    <ol className="flex flex-col gap-1.5">
      {ranked.map((r, i) => (
        <li
          key={`${r.name}-${i}`}
          className={`flex items-baseline justify-between gap-3 rounded-lg border px-3 py-2 ${
            r.busted ? "border-fg/5 text-fg/35" : "border-fg/10 text-fg"
          }`}
        >
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-sm tabular-nums w-6 shrink-0">
              {r.rank ?? "—"}
            </span>
            <span className="truncate">{r.name}</span>
          </span>
          <span className="font-mono tabular-nums whitespace-nowrap text-sm">
            {r.busted ? "Out" : formatChips(r.chips)}
          </span>
        </li>
      ))}
    </ol>
  );
}
