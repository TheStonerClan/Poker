import Link from "next/link";
import { notFound } from "next/navigation";

import { Headline } from "@/components/admin/HistoryBody";
import LocalDateTime from "@/components/admin/LocalDateTime";
import { SandboxBadge } from "@/components/SandboxBadge";
import { TournamentRosterTable } from "@/app/history/_components/TournamentRosterTable";
import { formatMoney } from "@/lib/admin/format";
import {
  buildPlayerTournamentHistory,
  buildTournamentSummaries,
  type FinishedTournament,
  type PayoutRow,
  type PlayerTournamentRow,
  type RosterRow,
  type TournamentSummaryRow,
} from "@/lib/admin/history-stats";
import {
  buildTournamentTimeline,
  type RawEvent,
  type TimelineEvent,
} from "@/lib/admin/tournament-timeline";
import { createServiceClient } from "@/lib/supabase/service";

type TournamentDetail = {
  summary: TournamentSummaryRow;
  rows: PlayerTournamentRow[];
  timeline: TimelineEvent[];
};

async function loadTournamentDetail(args: {
  supabase: ReturnType<typeof createServiceClient>;
  tournamentId: string;
  isSandbox: boolean;
}): Promise<TournamentDetail | null> {
  const { supabase, tournamentId, isSandbox } = args;

  const { data: t } = await supabase
    .from("tournaments")
    .select(
      "id, template_id, status, finished_at, started_at, buy_in_snapshot, current_level, rebuy_price_snapshot, buyback_config_snapshot, blind_structure_snapshot",
    )
    .eq("id", tournamentId)
    .eq("status", "finished")
    .eq("is_sandbox", isSandbox)
    .maybeSingle();
  if (!t) return null;

  const tournament = t as FinishedTournament & { blind_structure_snapshot?: unknown };

  const [{ data: rosterData }, { data: payoutsData }, { data: eventsData }] =
    await Promise.all([
      supabase
        .from("tournament_players")
        .select("*, player:players!tournament_players_player_id_fkey(id, name)")
        .eq("tournament_id", tournamentId),
      supabase
        .from("prize_distributions")
        .select("tournament_id, position, amount, player_id, is_chopped")
        .eq("tournament_id", tournamentId),
      supabase
        .from("tournament_events")
        .select("id, type, payload, created_at")
        .eq("tournament_id", tournamentId)
        .order("created_at", { ascending: true }),
    ]);

  // `id` (the tournament_player row id, needed to resolve `undo`
  // events' tournament_player_id back to a name) isn't on the shared
  // RosterRow type — `select("*", ...)` returns it at runtime anyway,
  // this just extends the local type to acknowledge it.
  const roster = (rosterData ?? []) as unknown as Array<
    RosterRow & { id: string }
  >;
  const payouts = (payoutsData ?? []) as PayoutRow[];
  const events = (eventsData ?? []) as unknown as RawEvent[];

  const [summary] = buildTournamentSummaries({
    tournaments: [tournament],
    roster,
    payouts,
  });
  const rows = buildPlayerTournamentHistory({
    tournaments: [tournament],
    roster,
    payouts,
  }).sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  // Level labels from this tournament's own blind structure snapshot —
  // same pattern HistoryBody uses for the bust histogram.
  const levelLabels = new Map<number, string>();
  if (tournament.blind_structure_snapshot) {
    const levels = Array.isArray(tournament.blind_structure_snapshot)
      ? (tournament.blind_structure_snapshot as Array<{
          level_num?: number;
          small?: number;
          big?: number;
          is_break?: boolean;
        }>)
      : [];
    for (const lvl of levels) {
      if (typeof lvl.level_num !== "number") continue;
      if (lvl.is_break) {
        levelLabels.set(lvl.level_num, "Break");
      } else if (typeof lvl.small === "number" && typeof lvl.big === "number") {
        levelLabels.set(lvl.level_num, `${lvl.small}/${lvl.big}`);
      }
    }
  }
  const levelLabel = (n: number | null | undefined) =>
    n == null ? "—" : (levelLabels.get(n) ?? `L${n}`);

  const nameByPlayerId = new Map<string, string>();
  const nameByTournamentPlayerId = new Map<string, string>();
  for (const r of roster) {
    if (r.player_id && r.player?.name) nameByPlayerId.set(r.player_id, r.player.name);
    if (r.id && r.player?.name) nameByTournamentPlayerId.set(r.id, r.player.name);
  }

  const timeline = buildTournamentTimeline({
    events,
    nameByPlayerId,
    nameByTournamentPlayerId,
    levelLabel,
  });

  return { summary, rows, timeline };
}

/**
 * Tournament detail page — reachable from a tournament's row on
 * /history and from an entry in a player's own tournament history.
 * Shows the full roster's per-player stats (not just the winner, like
 * the summary card on /history does) and the complete event timeline
 * for that night.
 */
export default async function TournamentHistoryBody({
  tournamentId,
  isSandbox,
  listBasePath,
}: {
  tournamentId: string;
  isSandbox: boolean;
  listBasePath: string;
}) {
  const supabase = createServiceClient();
  const detail = await loadTournamentDetail({ supabase, tournamentId, isSandbox });
  if (!detail) notFound();

  const { summary, rows, timeline } = detail;

  return (
    <main className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-baseline justify-between gap-3 border-b border-fg/10 px-5 py-4">
        <div>
          <p className="text-label uppercase tracking-[0.3em] text-[10px] font-semibold">
            Holdem Clock
          </p>
          <h1 className="mt-0.5 flex items-center gap-2 text-xl font-semibold text-fg">
            <LocalDateTime
              iso={summary.finishedAt}
              options={{ month: "short", day: "numeric", year: "numeric" }}
            />
            {isSandbox ? <SandboxBadge /> : null}
          </h1>
          <p className="mt-0.5 text-xs text-fg/55">
            {formatMoney(summary.prizePool)} pool · {formatMoney(summary.buyIn)}{" "}
            buy-in
            {summary.chopped ? " · chopped" : ""}
          </p>
        </div>
        <Link
          href={listBasePath}
          className="text-[11px] uppercase tracking-widest text-fg/55 hover:text-fg"
        >
          ← All tournaments
        </Link>
      </header>

      <div className="flex flex-1 flex-col gap-5 px-5 py-4">
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Headline label="Entries" value={summary.entries.toString()} />
          <Headline label="Rebuys" value={summary.rebuys.toString()} />
          <Headline label="Add-ons" value={summary.addOns.toString()} />
          <Headline label="Pool" value={formatMoney(summary.prizePool)} />
        </section>

        <section className="rounded-md border border-fg/10 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              Everyone who played
            </h2>
            <span className="text-[10px] uppercase tracking-widest text-fg/40">
              Tap a header to re-sort
            </span>
          </div>
          <TournamentRosterTable rows={rows} basePath={listBasePath} />
        </section>

        <section>
          <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
            Chain of events
          </h2>
          <ul className="flex flex-col gap-1.5">
            {timeline.map((ev) => (
              <li
                key={ev.id}
                className="flex items-baseline gap-3 rounded-md border border-fg/10 px-3 py-2 text-xs"
              >
                <span className="w-16 shrink-0 font-mono tabular-nums text-fg/45">
                  <LocalDateTime
                    iso={ev.createdAt}
                    options={{ hour: "numeric", minute: "2-digit" }}
                  />
                </span>
                <span className="text-fg/85">{ev.description}</span>
              </li>
            ))}
            {timeline.length === 0 ? (
              <li className="text-xs italic text-fg/40">No events recorded.</li>
            ) : null}
          </ul>
        </section>
      </div>
    </main>
  );
}
