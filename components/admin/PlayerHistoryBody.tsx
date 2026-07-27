import Link from "next/link";
import { notFound } from "next/navigation";

import { Headline, RangeFilter } from "@/components/admin/HistoryBody";
import LocalDateTime from "@/components/admin/LocalDateTime";
import { SandboxBadge } from "@/components/SandboxBadge";
import { PlayerLink } from "@/app/history/_components/PlayerLink";
import { BASE_BOUNTY_AMOUNT } from "@/lib/bounty";
import { formatMoney } from "@/lib/admin/format";
import {
  applyHistoryRange,
  buildPlayerStats,
  buildPlayerTournamentHistory,
  isHistoryRange,
  rangeLabel,
  type FinishedTournament,
  type HistoryRange,
  type PayoutRow,
  type PlayerStatsRow,
  type PlayerTournamentRow,
  type RosterRow,
  type TokenEvent,
} from "@/lib/admin/history-stats";
import { ordinal } from "@/lib/tv/prize";
import { createServiceClient } from "@/lib/supabase/service";

const TOURNAMENT_LIMIT = 60;

type SearchParams = { range?: string };

type PlayerBountyRow = {
  tournamentId: string;
  finishedAt: string | null;
  amount: number;
  isStacked: boolean;
  role: "target" | "collector";
  otherPlayerId: string | null;
  otherPlayerName: string | null;
};

type PlayerProfile = {
  playerName: string;
  hasAnyGamesEver: boolean;
  stats: PlayerStatsRow | null;
  history: PlayerTournamentRow[];
  bounties: PlayerBountyRow[];
};

async function loadPlayerProfile(args: {
  supabase: ReturnType<typeof createServiceClient>;
  playerId: string;
  isSandbox: boolean;
  range: HistoryRange;
}): Promise<PlayerProfile | null> {
  const { supabase, playerId, isSandbox, range } = args;

  const { data: playerRow } = await supabase
    .from("players")
    .select("id, name")
    .eq("id", playerId)
    .maybeSingle();
  if (!playerRow) return null;

  const { data: finished } = await supabase
    .from("tournaments")
    .select(
      "id, template_id, status, finished_at, started_at, buy_in_snapshot, current_level, rebuy_price_snapshot, buyback_config_snapshot, bounty_target_player_id, bounty_amount, bounty_collected_by_player_id",
    )
    .eq("status", "finished")
    .eq("is_sandbox", isSandbox)
    .order("finished_at", { ascending: false })
    .limit(TOURNAMENT_LIMIT);

  const allTournaments = (finished ?? []) as FinishedTournament[];
  if (allTournaments.length === 0) {
    return {
      playerName: playerRow.name,
      hasAnyGamesEver: false,
      stats: null,
      history: [],
      bounties: [],
    };
  }

  // Pull this player's roster rows across every candidate tournament
  // once, then slice per range in-memory — same "maximal window, filter
  // in JS" approach HistoryBody uses. Lets us tell "never played here"
  // apart from "no games in THIS window" without a second query.
  const allTournamentIds = allTournaments.map((t) => t.id);
  const { data: allRosterData } = await supabase
    .from("tournament_players")
    .select("*, player:players(id, name)")
    .eq("player_id", playerId)
    .in("tournament_id", allTournamentIds);
  const allRoster = (allRosterData ?? []) as unknown as RosterRow[];
  const hasAnyGamesEver = allRoster.length > 0;

  const tournaments = applyHistoryRange(allTournaments, range);
  const tournamentIds = new Set(tournaments.map((t) => t.id));
  const roster = allRoster.filter((r) => tournamentIds.has(r.tournament_id));

  if (tournamentIds.size === 0 || roster.length === 0) {
    return {
      playerName: playerRow.name,
      hasAnyGamesEver,
      stats: null,
      history: [],
      bounties: [],
    };
  }

  const playedIds = roster.map((r) => r.tournament_id);
  const [{ data: payoutsData }, { data: rebuyData }, { data: addOnData }] =
    await Promise.all([
      supabase
        .from("prize_distributions")
        .select("tournament_id, position, amount, player_id, is_chopped")
        .eq("player_id", playerId)
        .in("tournament_id", playedIds),
      supabase
        .from("tournament_events")
        .select("tournament_id, payload, created_at")
        .eq("type", "rebuy")
        .in("tournament_id", playedIds),
      supabase
        .from("tournament_events")
        .select("tournament_id, payload, created_at")
        .eq("type", "addon")
        .in("tournament_id", playedIds),
    ]);

  const payouts = (payoutsData ?? []) as PayoutRow[];
  // Events store player_id inside the JSON payload, not as a column.
  const matchesPlayer = (e: { payload: unknown }) => {
    const p = e.payload as { player_id?: unknown } | null;
    return typeof p?.player_id === "string" && p.player_id === playerId;
  };
  const rebuyEvents = ((rebuyData ?? []) as unknown as TokenEvent[]).filter(
    matchesPlayer,
  );
  const addOnEvents = ((addOnData ?? []) as unknown as TokenEvent[]).filter(
    matchesPlayer,
  );

  const allStats = buildPlayerStats({
    tournaments,
    roster,
    payouts,
    rebuyEvents,
    addOnEvents,
  });
  const stats = allStats.find((s) => s.playerId === playerId) ?? null;
  const history = buildPlayerTournamentHistory({ tournaments, roster, payouts });

  // Bounty involvement within this range — tournaments where the
  // player was either the target or the collector. Roster here only
  // has this player's own row, so the OTHER party's name needs a
  // small separate lookup.
  const involved = tournaments.filter(
    (t) =>
      t.bounty_target_player_id === playerId ||
      t.bounty_collected_by_player_id === playerId,
  );
  const otherIds = new Set<string>();
  for (const t of involved) {
    if (t.bounty_target_player_id && t.bounty_target_player_id !== playerId) {
      otherIds.add(t.bounty_target_player_id);
    }
    if (
      t.bounty_collected_by_player_id &&
      t.bounty_collected_by_player_id !== playerId
    ) {
      otherIds.add(t.bounty_collected_by_player_id);
    }
  }
  let otherNames = new Map<string, string>();
  if (otherIds.size > 0) {
    const { data: otherPlayers } = await supabase
      .from("players")
      .select("id, name")
      .in("id", [...otherIds]);
    otherNames = new Map((otherPlayers ?? []).map((p) => [p.id, p.name]));
  }

  const bounties: PlayerBountyRow[] = [];
  for (const t of involved) {
    const amount = Number(t.bounty_amount ?? BASE_BOUNTY_AMOUNT);
    const isStacked = amount > BASE_BOUNTY_AMOUNT;
    if (t.bounty_target_player_id === playerId) {
      const collectorId = t.bounty_collected_by_player_id ?? null;
      bounties.push({
        tournamentId: t.id,
        finishedAt: t.finished_at,
        amount,
        isStacked,
        role: "target",
        otherPlayerId: collectorId,
        otherPlayerName: collectorId ? (otherNames.get(collectorId) ?? "—") : null,
      });
    }
    if (t.bounty_collected_by_player_id === playerId) {
      const targetId = t.bounty_target_player_id ?? null;
      bounties.push({
        tournamentId: t.id,
        finishedAt: t.finished_at,
        amount,
        isStacked,
        role: "collector",
        otherPlayerId: targetId,
        otherPlayerName: targetId ? (otherNames.get(targetId) ?? "—") : null,
      });
    }
  }
  bounties.sort((a, b) => {
    const at = a.finishedAt ? Date.parse(a.finishedAt) : 0;
    const bt = b.finishedAt ? Date.parse(b.finishedAt) : 0;
    return bt - at;
  });

  return { playerName: playerRow.name, hasAnyGamesEver, stats, history, bounties };
}

/**
 * Shared body for /history/[player] (real) and
 * /sandboxadmin/history/[player] (sandbox) — mirrors HistoryBody's
 * isSandbox/basePath/homeHref split so each surface stays scoped to
 * its own data. `listBasePath` is the parent list page's path
 * ("/history" or "/sandboxadmin/history"); this page's own URL (used
 * for the range-filter pills) is `${listBasePath}/${playerId}`.
 */
export default async function PlayerHistoryBody({
  searchParams,
  isSandbox,
  listBasePath,
  playerId,
}: {
  searchParams: Promise<SearchParams>;
  isSandbox: boolean;
  listBasePath: string;
  playerId: string;
}) {
  const { range: rangeParam } = await searchParams;
  const range: HistoryRange = isHistoryRange(rangeParam) ? rangeParam : "all";

  const supabase = createServiceClient();
  const profile = await loadPlayerProfile({ supabase, playerId, isSandbox, range });
  if (!profile) notFound();

  const ownPath = `${listBasePath}/${playerId}`;
  const { stats, history, bounties } = profile;

  return (
    <main className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="flex items-baseline justify-between gap-3 border-b border-fg/10 px-5 py-4">
        <div>
          <p className="text-label uppercase tracking-[0.3em] text-[10px] font-semibold">
            Holdem Clock
          </p>
          <h1 className="mt-0.5 flex items-center gap-2 text-xl font-semibold text-fg">
            {profile.playerName}
            {isSandbox ? <SandboxBadge /> : null}
          </h1>
          <p className="mt-0.5 text-xs text-fg/55">
            {rangeLabel(range)} ·{" "}
            {history.length} tournament{history.length === 1 ? "" : "s"} in
            this window
          </p>
        </div>
        <Link
          href={listBasePath}
          className="text-[11px] uppercase tracking-widest text-fg/55 hover:text-fg"
        >
          ← All players
        </Link>
      </header>

      <div className="flex flex-1 flex-col gap-5 px-5 py-4">
        <RangeFilter active={range} basePath={ownPath} />

        {!profile.hasAnyGamesEver ? (
          <div className="rounded-md border border-dashed border-fg/15 p-6 text-center text-sm text-fg/60">
            No finished tournaments on record for {profile.playerName}
            {isSandbox ? " in the sandbox" : ""} yet.
          </div>
        ) : !stats ? (
          <div className="rounded-md border border-dashed border-fg/15 p-6 text-center text-sm text-fg/60">
            No games in this window (
            {rangeLabel(range).toLowerCase()}). Try &quot;All time&quot; —{" "}
            {profile.playerName} has played before, just not recently
            enough for this filter.
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <Headline label="Points" value={stats.points.toString()} />
              <Headline label="Played" value={stats.tournamentsPlayed.toString()} />
              <Headline label="Wins" value={stats.wins.toString()} />
              <Headline label="ITM" value={stats.itmCount.toString()} />
              <Headline
                label="Net"
                value={`${stats.net >= 0 ? "+" : ""}${formatMoney(stats.net)}`}
              />
            </section>

            <section className="rounded-md border border-fg/10 p-4">
              <h2 className="text-label mb-3 text-[11px] font-semibold uppercase tracking-[0.25em]">
                Tendencies
              </h2>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <StatRow
                  label="Avg bust level"
                  value={
                    stats.avgBustLevel != null
                      ? `L${stats.avgBustLevel.toFixed(1)}`
                      : "—"
                  }
                />
                <StatRow
                  label="Avg finish"
                  value={stats.avgFinish != null ? stats.avgFinish.toFixed(1) : "—"}
                />
                <StatRow
                  label="Rebuy rate"
                  value={`${Math.round(stats.rebuyRate * 100)}% · ${stats.totalRebuys} total`}
                />
                <StatRow
                  label="Avg rebuy level"
                  value={
                    stats.avgRebuyLevel != null
                      ? `L${stats.avgRebuyLevel.toFixed(1)}`
                      : "—"
                  }
                />
                <StatRow label="Add-ons" value={stats.totalAddOns.toString()} />
                <StatRow label="Gross / cost" value={`${formatMoney(stats.grossWinnings)} / ${formatMoney(stats.costBasis)}`} />
              </dl>
            </section>

            {bounties.length > 0 ? (
              <section className="rounded-md border border-fg/10 p-4">
                <h2 className="text-label mb-3 text-[11px] font-semibold uppercase tracking-[0.25em]">
                  Bounty history
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {bounties.map((b) => (
                    <li
                      key={`${b.tournamentId}-${b.role}`}
                      className="flex items-baseline justify-between gap-2 px-2 py-1 text-xs"
                    >
                      <span className="text-fg/55">
                        <LocalDateTime iso={b.finishedAt} /> ·{" "}
                        {formatMoney(b.amount)}
                        {b.isStacked ? (
                          <span className="ml-1 text-gold/80">stacked</span>
                        ) : null}
                      </span>
                      <span className="font-mono tabular-nums text-fg/70">
                        {b.role === "collector" ? (
                          <>
                            collected off{" "}
                            {b.otherPlayerId && b.otherPlayerName ? (
                              <PlayerLink
                                basePath={listBasePath}
                                playerId={b.otherPlayerId}
                                name={b.otherPlayerName}
                              />
                            ) : (
                              "—"
                            )}
                          </>
                        ) : b.otherPlayerId && b.otherPlayerName ? (
                          <>
                            collected by{" "}
                            <PlayerLink
                              basePath={listBasePath}
                              playerId={b.otherPlayerId}
                              name={b.otherPlayerName}
                            />
                          </>
                        ) : (
                          "unclaimed"
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
                Tournament history
              </h2>
              <ul className="flex flex-col gap-2">
                {history.map((h) => (
                  <li
                    key={h.tournamentId}
                    className="block rounded-md border border-fg/10 px-3 py-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-fg">
                        <LocalDateTime iso={h.finishedAt} />
                      </p>
                      <p className="font-mono text-xs tabular-nums text-fg">
                        {h.position != null
                          ? ordinal(h.position)
                          : h.bustedAtLevel != null
                            ? `Out L${h.bustedAtLevel}`
                            : "—"}
                      </p>
                    </div>
                    <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-fg/60">
                      <p className="font-mono tabular-nums">
                        {h.rebuys} rebuy{h.rebuys === 1 ? "" : "s"} ·{" "}
                        {h.addOns} add-on{h.addOns === 1 ? "" : "s"} ·{" "}
                        {formatMoney(h.buyIn)} buy-in
                      </p>
                      <p
                        className={`font-mono tabular-nums font-semibold ${
                          h.net >= 0 ? "text-success" : "text-danger"
                        }`}
                      >
                        {h.net >= 0 ? "+" : ""}
                        {formatMoney(h.net)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs text-fg/60">{label}</dt>
      <dd className="text-right font-mono tabular-nums text-fg">{value}</dd>
    </>
  );
}
