import Link from "next/link";
import { notFound } from "next/navigation";

import { TopBar } from "@/components/admin/TopBar";
import {
  blindLevels,
  currentLevel,
  getPendingColorUpRequests,
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
import { computePayouts } from "prize-math";

import { LevelControls } from "../../_components/LevelControls";
import { PlayerGrid } from "./_components/PlayerGrid";
import { ColorUpInbox } from "./_components/ColorUpInbox";
import { FinalizeButton } from "./_components/FinalizeButton";

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
  const [roster, pendingColorUps, snapshotEventsRes] = await Promise.all([
    getTournamentRoster(tournament.id),
    getPendingColorUpRequests(tournament.id),
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
  ]);
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

  const totalLevels = blindLevels(tournament.blind_structure_snapshot).reduce(
    (m, l) => (l.level_num > m ? l.level_num : m),
    0,
  );

  return (
    <>
      <TopBar
        title={`Level ${tournament.current_level}/${totalLevels}`}
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
              {formatChips(roster.reduce((s, r) => s + r.current_chips, 0))} chips total
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
      </main>
    </>
  );
}
