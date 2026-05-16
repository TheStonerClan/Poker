import Link from "next/link";
import { notFound } from "next/navigation";

import { TopBar } from "@/components/admin/TopBar";
import {
  blindLevels,
  currentLevel,
  getApprovedColorUpGains,
  getPendingColorUpRequests,
  getPlayers,
  getTournament,
  getTournamentRoster,
  nextLevel,
} from "@/lib/admin/queries";
import {
  latestChipSnapshotPerPlayer,
  type ChipSnapshotEvent,
} from "@/lib/admin/chip-snapshots";
import { formatBlinds, formatChips, formatMoney } from "@/lib/admin/format";
import { createClient } from "@/lib/supabase/server";
import { formatLevelLabel, levelCounts } from "@/lib/tv/levels";
import { computePayouts } from "prize-math";

import {
  aggregateByTable,
  canMerge,
  groupByTable,
  resolveTablesConfig,
  TABLE_COLOR_CSS,
} from "@/lib/admin/tables";

import { AutoAdvanceWatcher } from "../../_components/AutoAdvanceWatcher";
import { LevelControls } from "../../_components/LevelControls";
import { PlayerGrid } from "./_components/PlayerGrid";
import { ColorUpInbox } from "./_components/ColorUpInbox";
import { DeleteTournamentButton } from "./_components/DeleteTournamentButton";
import { FinalizeButton } from "./_components/FinalizeButton";
import { RerandomizeButton } from "./_components/RerandomizeButton";
import {
  AddPlayersPicker,
  RemovePlayerButton,
} from "./_components/RosterControls";
import { TableActions } from "./_components/TableActions";

export const dynamic = "force-dynamic";

export default async function LiveTournamentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tournament = await getTournament(id);
  if (!tournament) notFound();

  const supabase = await createClient();
  // Master players list is only needed when status='scheduled' (drives
  // the "add players" picker). Skip the query otherwise to keep the
  // running-tournament render path lean.
  const isScheduled = tournament.status === "scheduled";
  const [
    roster,
    pendingColorUps,
    colorUpGains,
    snapshotEventsRes,
    allPlayers,
  ] = await Promise.all([
    getTournamentRoster(tournament.id),
    getPendingColorUpRequests(tournament.id),
    // Net chip deltas from approved color-ups. Threaded into
    // aggregateByTable below + the "X chips total" footer so a
    // round-up exchange ($23 → $25) shows the +$2 in the pool.
    getApprovedColorUpGains(tournament.id),
    // Pull every chip_snapshot event for this tournament so we can show
    // each player's latest self-reported total + the Δ from their
    // previous report, on their PlayerGrid tile. Ordered ascending so
    // the latestChipSnapshotPerPlayer reducer keeps the last one.
    supabase
      .from("tournament_events")
      .select("type, payload, created_at")
      .eq("tournament_id", tournament.id)
      .eq("type", "chip_snapshot")
      .order("created_at", { ascending: true }),
    isScheduled ? getPlayers() : Promise.resolve([]),
  ]);
  const colorUpDelta = colorUpGains.reduce((s, g) => s + g.net_change, 0);
  const snapshotEvents = (snapshotEventsRes.data ?? []) as ChipSnapshotEvent[];
  const latestSnapshotByPlayer = latestChipSnapshotPerPlayer(snapshotEvents);

  const cur = currentLevel(tournament);
  const nxt = nextLevel(tournament);
  const inPlay = roster.filter((r) => !r.busted_at_time);
  const out = roster.filter((r) => r.busted_at_time);
  // Total buybacks = rebuys + add-ons across all players (counters added
  // in 0003 to support tokensPerPlayer > 1). A single roster row may
  // contribute multiple paid entries.
  const buybacks = roster.reduce(
    (s, r) => s + (r.rebuys_used ?? 0) + (r.addons_used ?? 0),
    0,
  );

  const payouts = computePayouts(
    tournament.prize_rules_snapshot as Parameters<typeof computePayouts>[0],
    {
      buyIns: roster.length,
      buybacks,
      buyInPrice: tournament.buy_in_snapshot,
    },
  );

  const buybackCfg = tournament.buyback_config_snapshot as {
    rebuyAllowedThroughLevel?: number;
    addOnAtBreakLevel?: number;
  };

  const levels = blindLevels(tournament.blind_structure_snapshot);
  const counts = levelCounts(levels);
  const curLabel = formatLevelLabel(levels, tournament.current_level);
  const totalOfKind = cur?.is_break ? counts.breaks : counts.playable;

  return (
    <>
      <AutoAdvanceWatcher
        tournament={{
          id: tournament.id,
          status: tournament.status,
          current_level: tournament.current_level,
          level_started_at: tournament.level_started_at,
          level_paused_at: tournament.level_paused_at,
          accumulated_pause_ms: tournament.accumulated_pause_ms,
          blind_structure_snapshot: tournament.blind_structure_snapshot,
        }}
      />
      <TopBar
        title={`${curLabel} of ${totalOfKind}`}
        subtitle={`${tournament.status.toUpperCase()} · ${formatBlinds(cur)}`}
        back={{ href: "/admin", label: "Dashboard" }}
        action={
          <Link
            href={`/admin/tournaments/${tournament.id}#finalize`}
            className="rounded-md border border-fg/15 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg/80"
          >
            Pool {formatMoney(payouts.effectivePool)}
          </Link>
        }
      />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <section className="rounded-lg border border-gold/30 bg-gold/5 p-4">
          <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Current
          </p>
          <p className="mt-1 text-3xl font-semibold">
            {cur?.is_break ? "Break" : formatBlinds(cur)}
          </p>
          <p className="mt-1 text-xs text-fg/60">
            Next: {formatBlinds(nxt)}
            {cur?.duration_sec
              ? ` · ${Math.round(cur.duration_sec / 60)} min`
              : ""}
          </p>
        </section>

        <LevelControls tournament={tournament} />

        {(tournament.status === "running" || tournament.status === "paused") &&
        tournament.num_tables &&
        tournament.num_tables > 1
          ? (() => {
              const tablesCfg = resolveTablesConfig({
                tablesConfig: tournament.tables_config,
                numTables: tournament.num_tables,
                maxSeatsPerTable: tournament.max_seats_per_table,
              });
              const buyback = (tournament.buyback_config_snapshot ?? {}) as {
                rebuyChips?: number;
                addOnChips?: number;
              };
              const stats = aggregateByTable({
                rows: roster.map((r) => ({
                  table_number: r.table_number,
                  player_id: r.player_id,
                  current_chips: r.current_chips,
                  busted_at_time: r.busted_at_time,
                  buyback_used: r.buyback_used,
                  buyback_used_as: r.buyback_used_as,
                  rebuys_used: r.rebuys_used,
                  addons_used: r.addons_used,
                  players: r.player
                    ? { id: r.player.id, name: r.player.name }
                    : null,
                })),
                tablesConfig: tablesCfg,
                chipsCfg: {
                  startingStack: tournament.starting_stack_snapshot ?? 0,
                  rebuyChips:
                    buyback.rebuyChips ?? tournament.rebuy_chips_snapshot ?? 0,
                  addOnChips: buyback.addOnChips ?? 0,
                },
                colorUpGains,
              });
              const counts = stats.map((s) => s.activePlayers);
              const spread =
                counts.length > 0
                  ? Math.max(...counts) - Math.min(...counts)
                  : 0;
              const totalActive = counts.reduce((s, n) => s + n, 0);
              return (
                <TableActions
                  tournamentId={tournament.id}
                  spread={spread}
                  mergeFeasible={canMerge(stats)}
                  activeCount={totalActive}
                />
              );
            })()
          : null}

        {tournament.status === "scheduled" && tournament.num_tables ? (
          <section className="rounded-lg border border-gold/30 bg-gold/5 p-4">
            {(() => {
              const tablesCfg = resolveTablesConfig({
                tablesConfig: tournament.tables_config,
                numTables: tournament.num_tables,
                maxSeatsPerTable: tournament.max_seats_per_table,
              });
              const totalSeats = tablesCfg.reduce(
                (s, t) => s + t.max_seats,
                0,
              );
              return (
                <>
                  <div className="mb-3 flex items-baseline justify-between gap-2">
                    <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
                      Table assignments
                    </h2>
                    <span className="text-xs text-fg/55">
                      {tablesCfg.length} table
                      {tablesCfg.length === 1 ? "" : "s"} · {totalSeats} seats
                    </span>
                  </div>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {Array.from(
                      groupByTable(
                        roster.map((r) => ({
                          ...r,
                          table_number: r.table_number ?? null,
                        })),
                        tablesCfg.length,
                      ),
                    )
                      .sort(([a], [b]) => a - b)
                      .map(([tableNum, rows]) => {
                        const cfg = tablesCfg[tableNum - 1];
                        const css = cfg
                          ? TABLE_COLOR_CSS[cfg.color]
                          : TABLE_COLOR_CSS.gold;
                        const sorted = [...rows].sort(
                          (a, b) =>
                            (a.seat_number ?? Number.POSITIVE_INFINITY) -
                            (b.seat_number ?? Number.POSITIVE_INFINITY),
                        );
                        return (
                          <li
                            key={tableNum}
                            className="rounded-md border-2 p-3"
                            style={{
                              borderColor: css.border,
                              background: css.bg,
                            }}
                          >
                            <p
                              className="text-[10px] font-semibold uppercase tracking-widest"
                              style={{ color: css.text }}
                            >
                              {cfg?.name ?? `Table ${tableNum}`} ·{" "}
                              {sorted.length}/{cfg?.max_seats ?? "?"} seated
                            </p>
                            {sorted.length === 0 ? (
                              <p className="mt-1 text-xs italic text-fg/40">
                                No players assigned.
                              </p>
                            ) : (
                              <ul className="mt-2 flex flex-col gap-0.5">
                                {sorted.map((p) => (
                                  <li
                                    key={p.id}
                                    className="flex items-baseline gap-2 text-sm"
                                  >
                                    <span
                                      className="font-mono w-[3ch] text-right tabular-nums"
                                      style={{ color: css.text }}
                                    >
                                      {p.seat_number ?? "—"}
                                    </span>
                                    <span className="flex-1 text-fg">
                                      {p.player?.name ?? "—"}
                                    </span>
                                    <RemovePlayerButton
                                      tournamentId={tournament.id}
                                      tournamentPlayerId={p.id}
                                      playerName={p.player?.name ?? "this player"}
                                    />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                  </ul>
                </>
              );
            })()}
            <div className="mt-3">
              <RerandomizeButton tournamentId={tournament.id} />
            </div>

            <div className="mt-4 border-t border-fg/10 pt-3">
              <h3 className="text-label text-[10px] font-semibold uppercase tracking-[0.25em]">
                Add players
              </h3>
              <p className="mt-1 text-[10px] text-fg/50">
                Late RSVPs land in the lowest free seat at whichever
                table has the most room. Hit Re-randomize above if you
                want a fresh shuffle of everyone.
              </p>
              <div className="mt-2">
                <AddPlayersPicker
                  tournamentId={tournament.id}
                  allPlayers={allPlayers.map((p) => ({
                    id: p.id,
                    name: p.name,
                  }))}
                  rosteredPlayerIds={roster
                    .map((r) => r.player_id)
                    .filter((id): id is string => Boolean(id))}
                />
              </div>
            </div>

            <p className="mt-2 text-[10px] text-fg/50">
              The TV is showing this layout to walk-ins. Once you advance
              past Level 0 (or otherwise start the timer) the screen flips
              to the live timer automatically.
            </p>
          </section>
        ) : null}

        {pendingColorUps.length > 0 ? (
          <section
            id="color-up"
            className="rounded-lg border border-gold/40 bg-gold/5 p-3"
          >
            <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
              Color-up inbox · {pendingColorUps.length}
            </h2>
            <ColorUpInbox requests={pendingColorUps} />
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              In play · {inPlay.length}
            </h2>
            <span className="text-xs text-fg/50">
              {buybacks} buyback{buybacks === 1 ? "" : "s"}
            </span>
          </div>
          <PlayerGrid
            currentLevel={tournament.current_level}
            buybackConfig={buybackCfg}
            rows={inPlay.map((r) => ({
              id: r.id,
              name: r.player?.name ?? "—",
              chips: r.current_chips,
              busted: false,
              buybackUsed: r.buyback_used,
              buybackUsedAs: r.buyback_used_as,
              latestSnapshot: r.player_id
                ? (latestSnapshotByPlayer.get(r.player_id) ?? null)
                : null,
            }))}
          />
        </section>

        {out.length > 0 ? (
          <section>
            <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
              Out · {out.length}
            </h2>
            <PlayerGrid
              currentLevel={tournament.current_level}
              buybackConfig={buybackCfg}
              rows={out.map((r) => ({
                id: r.id,
                name: r.player?.name ?? "—",
                chips: r.current_chips,
                busted: true,
                bustedAtLevel: r.busted_at_level,
                buybackUsed: r.buyback_used,
                buybackUsedAs: r.buyback_used_as,
                latestSnapshot: r.player_id
                  ? (latestSnapshotByPlayer.get(r.player_id) ?? null)
                  : null,
              }))}
            />
          </section>
        ) : null}

        <section className="rounded-lg border border-fg/10 p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              Projected payouts
            </h2>
            <span className="text-xs text-fg/60">
              {/* Conservation: total chips in play = entries × starting +
                  rebuys × rebuyChips + addons × addOnChips + sum of
                  approved color-up net_changes (round-ups add chips to
                  the pool — $23 → $25 puts +$2 in play). Summing
                  current_chips drops the total when players bust, but
                  the chips are still on the table. */}
              {formatChips(
                roster.length * (tournament.starting_stack_snapshot ?? 0) +
                  roster.reduce((s, r) => s + (r.rebuys_used ?? 0), 0) *
                    (tournament.rebuy_chips_snapshot ?? 0) +
                  roster.reduce((s, r) => s + (r.addons_used ?? 0), 0) *
                    ((buybackCfg as { addOnChips?: number }).addOnChips ?? 0) +
                  colorUpDelta,
              )}{" "}
              chips total
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {payouts.payouts.map((p) => (
              <li key={p.position} className="flex justify-between">
                <span className="text-fg/70">Position {p.position}</span>
                <span className="font-mono">{formatMoney(p.amount)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="finalize"
          className="rounded-lg border border-fg/10 p-4"
        >
          <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
            Finalize
          </h2>
          <p className="mt-1 text-xs text-fg/60">
            Lock results, snapshot prize distribution, and reset for the next
            tournament. Cannot be undone.
          </p>
          <FinalizeButton
            tournamentId={tournament.id}
            disabled={tournament.finished_at != null}
            inPlayCount={inPlay.length}
          />
        </section>

        {tournament.status === "scheduled" ||
        tournament.status === "finished" ||
        tournament.status === "cancelled" ? (
          <section className="rounded-lg border border-danger/30 bg-danger/5 p-4">
            <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em] text-danger">
              Danger zone
            </h2>
            <p className="mt-1 text-xs text-fg/60">
              {tournament.status === "scheduled"
                ? "Cancel this tournament before it starts. Removes the staged roster and table assignments. Use if you set one up by mistake or it's a dummy run."
                : "Permanently delete this finalized tournament. Wipes the results, payouts, and event history. Use only for test/dummy tournaments — there is no undo."}
            </p>
            <div className="mt-3">
              <DeleteTournamentButton
                tournamentId={tournament.id}
                mode={tournament.status === "scheduled" ? "cancel" : "delete"}
              />
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
