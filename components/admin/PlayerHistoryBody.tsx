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
  buildBreakShiftStats,
  buildPlayerStats,
  buildPlayerTournamentHistory,
  isHistoryRange,
  rangeLabel,
  type ChipSnapshotEvent,
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
// Same threshold HistoryBody's Above/Below-average cards use — below
// this, "best" and "worst" can collapse to the same single check-in.
const MIN_CHIP_CHECKINS = 2;

type SearchParams = { range?: string };

type PlayerChipStats = {
  avgRatio: number;
  maxRatio: number;
  minRatio: number;
  tournamentsAbove: number;
  tournamentsBelow: number;
};

type PlayerBountyRow = {
  tournamentId: string;
  finishedAt: string | null;
  amount: number;
  isStacked: boolean;
  role: "target" | "collector";
  otherPlayerId: string | null;
  otherPlayerName: string | null;
};

type PlayerImpression = {
  text: string;
  generatedAt: string;
};

/** One tournament where this player is credited with a knockout — the "who I busted" side; the "who busted me" side lives on each `history` row. */
type PlayerKnockoutRow = {
  tournamentId: string;
  finishedAt: string | null;
  victimName: string;
};

type PlayerProfile = {
  playerName: string;
  hasAnyGamesEver: boolean;
  stats: PlayerStatsRow | null;
  history: PlayerTournamentRow[];
  bounties: PlayerBountyRow[];
  knockouts: PlayerKnockoutRow[];
  impression: PlayerImpression | null;
  chipStats: PlayerChipStats | null;
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

  // Independent of the range filter — the impression is always a
  // standing, all-time synopsis, refreshed on every finalize.
  const { data: impressionRow } = await supabase
    .from("player_impressions")
    .select("impression, generated_at")
    .eq("player_id", playerId)
    .eq("is_sandbox", isSandbox)
    .maybeSingle();
  const impression: PlayerImpression | null = impressionRow
    ? { text: impressionRow.impression, generatedAt: impressionRow.generated_at }
    : null;

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
      knockouts: [],
      impression,
      chipStats: null,
    };
  }

  // Pull this player's roster rows across every candidate tournament
  // once, then slice per range in-memory — same "maximal window, filter
  // in JS" approach HistoryBody uses. Lets us tell "never played here"
  // apart from "no games in THIS window" without a second query.
  const allTournamentIds = allTournaments.map((t) => t.id);
  const { data: allRosterData } = await supabase
    .from("tournament_players")
    .select("*, player:players!tournament_players_player_id_fkey(id, name)")
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
      knockouts: [],
      impression,
      chipStats: null,
    };
  }

  const playedIds = roster.map((r) => r.tournament_id);
  const [
    { data: payoutsData },
    { data: rebuyData },
    { data: addOnData },
    { data: snapshotData },
    { data: koVictimsData },
  ] = await Promise.all([
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
    // NOT scoped to this player — buildBreakShiftStats needs every
    // player's check-ins at these tournaments to compute an accurate
    // "chips vs. table average" for this one player.
    supabase
      .from("tournament_events")
      .select("tournament_id, payload, created_at")
      .eq("type", "chip_snapshot")
      .in("tournament_id", playedIds),
    // The flip side of `roster`'s own knocked_out_by_player_id: every
    // OTHER player's row this player is credited with busting. `roster`
    // (scoped to player_id = playerId) can't tell us this, so it's a
    // separate query rather than something buildPlayerStats can derive
    // from the roster we're passing it below.
    supabase
      .from("tournament_players")
      .select("tournament_id, player:players!tournament_players_player_id_fkey(id, name)")
      .eq("knocked_out_by_player_id", playerId)
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

  // buildPlayerStats credits knockouts by scanning `roster` for OTHER
  // players' rows with knocked_out_by_player_id === this player — but
  // `roster` here only holds this player's own rows, so `stats.knockouts`
  // came back 0 regardless of reality. Patch it (and koRatio) from the
  // dedicated koVictims query; totalEntries is unaffected since it only
  // depends on this player's own tournamentsPlayed/rebuys/addons.
  const finishedAtByTournament = new Map(tournaments.map((t) => [t.id, t.finished_at]));
  const koVictims = (koVictimsData ?? []) as unknown as Array<{
    tournament_id: string;
    player: { id: string; name: string } | null;
  }>;
  const knockouts: PlayerKnockoutRow[] = koVictims
    .map((v) => ({
      tournamentId: v.tournament_id,
      finishedAt: finishedAtByTournament.get(v.tournament_id) ?? null,
      victimName: v.player?.name ?? "—",
    }))
    .sort((a, b) => {
      const at = a.finishedAt ? Date.parse(a.finishedAt) : 0;
      const bt = b.finishedAt ? Date.parse(b.finishedAt) : 0;
      return bt - at;
    });
  if (stats) {
    stats.knockouts = knockouts.length;
    stats.koRatio = stats.totalEntries > 0 ? stats.knockouts / stats.totalEntries : 0;
  }

  const snapshotEvents = (snapshotData ?? []) as ChipSnapshotEvent[];
  const myBreakShift = buildBreakShiftStats({
    tournaments,
    roster,
    events: snapshotEvents,
  }).find((b) => b.playerId === playerId);
  const chipStats: PlayerChipStats | null =
    myBreakShift && myBreakShift.snapshotCount >= MIN_CHIP_CHECKINS
      ? {
          avgRatio: myBreakShift.avgChipsRatio,
          maxRatio: myBreakShift.maxChipsRatio,
          minRatio: myBreakShift.minChipsRatio,
          tournamentsAbove: myBreakShift.tournamentsAboveAverage,
          tournamentsBelow: myBreakShift.tournamentsBelowAverage,
        }
      : null;

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
  // buildPlayerTournamentHistory can only resolve a knocker's name from
  // `roster`, which here is scoped to this player alone — fold the
  // unresolved ids into the same other-player lookup.
  for (const h of history) {
    if (h.knockedOutByPlayerId && !h.knockedOutByName) {
      otherIds.add(h.knockedOutByPlayerId);
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
  for (const h of history) {
    if (h.knockedOutByPlayerId && !h.knockedOutByName) {
      h.knockedOutByName = otherNames.get(h.knockedOutByPlayerId) ?? null;
    }
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

  return {
    playerName: playerRow.name,
    hasAnyGamesEver,
    stats,
    history,
    bounties,
    knockouts,
    impression,
    chipStats,
  };
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
  const { stats, history, bounties, knockouts, impression, chipStats } = profile;

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

        {impression ? (
          <section className="rounded-md border border-gold/30 bg-gold/[0.04] p-4">
            <p className="text-label mb-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-gold/80">
              The impression
            </p>
            <p className="text-sm leading-relaxed text-fg">{impression.text}</p>
            <p className="mt-2 text-[10px] uppercase tracking-widest text-fg/35">
              Generated by Claude · updated{" "}
              <LocalDateTime
                iso={impression.generatedAt}
                options={{ month: "short", day: "numeric", year: "numeric" }}
              />
            </p>
          </section>
        ) : null}

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
                <StatRow label="Knockouts" value={stats.knockouts.toString()} />
                <StatRow
                  label="KO ratio"
                  value={`${stats.koRatio.toFixed(2)}/entry · ${stats.totalEntries} total`}
                />
              </dl>
            </section>

            {chipStats ? (
              <section className="rounded-md border border-fg/10 p-4">
                <h2 className="text-label mb-3 text-[11px] font-semibold uppercase tracking-[0.25em]">
                  Chip check-ins
                </h2>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <StatRow
                    label="Best above average"
                    value={`${chipStats.maxRatio.toFixed(2)}× · ${chipStats.tournamentsAbove} tournament${chipStats.tournamentsAbove === 1 ? "" : "s"}`}
                  />
                  <StatRow
                    label="Worst below average"
                    value={`${chipStats.minRatio.toFixed(2)}× · ${chipStats.tournamentsBelow} tournament${chipStats.tournamentsBelow === 1 ? "" : "s"}`}
                  />
                  <StatRow
                    label="Blended avg (all breaks)"
                    value={`${chipStats.avgRatio.toFixed(2)}×`}
                  />
                </dl>
              </section>
            ) : null}

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

            {knockouts.length > 0 ? (
              <section className="rounded-md border border-fg/10 p-4">
                <h2 className="text-label mb-3 text-[11px] font-semibold uppercase tracking-[0.25em]">
                  Knockouts dealt
                </h2>
                <ul className="flex flex-col gap-1.5">
                  {knockouts.map((k, i) => (
                    <li
                      key={`${k.tournamentId}-${i}`}
                      className="flex items-baseline justify-between gap-2 px-2 py-1 text-xs"
                    >
                      <span className="text-fg/55">
                        <LocalDateTime iso={k.finishedAt} />
                      </span>
                      <span className="font-mono tabular-nums text-fg/70">
                        KO&apos;d {k.victimName}
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
                  <li key={h.tournamentId}>
                    <Link
                      href={`${listBasePath}/tournament/${h.tournamentId}`}
                      className="block rounded-md border border-fg/10 px-3 py-3 hover:border-gold/40"
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
                          {h.knockedOutByName ? ` · KO by ${h.knockedOutByName}` : ""}
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
                    </Link>
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
