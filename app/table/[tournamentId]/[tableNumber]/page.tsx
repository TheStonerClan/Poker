import { notFound, redirect } from "next/navigation";

import { TopBar } from "@/components/admin/TopBar";
import { SandboxBadge } from "@/components/SandboxBadge";
import { getAuthContext } from "@/lib/auth/table-admin";
import Link from "next/link";

import { currentLevel } from "@/lib/admin/queries";
import type {
  ColorUpRequest,
  Player,
  TournamentRosterRow,
} from "@/lib/admin/queries";
import type { Tables } from "@/lib/database.types";
import {
  latestChipSnapshotPerPlayer,
  type ChipSnapshotEvent,
} from "@/lib/admin/chip-snapshots";
import { formatBlinds } from "@/lib/admin/format";
import { createServiceClient } from "@/lib/supabase/service";
import {
  resolveTablesConfig,
  TABLE_COLOR_CSS,
} from "@/lib/admin/tables";

import { ChipSnapshotPanel } from "@/app/admin/tournaments/[id]/_components/ChipSnapshotPanel";
import { ColorUpInbox } from "@/app/admin/tournaments/[id]/_components/ColorUpInbox";
import { PlayerGrid } from "@/app/admin/tournaments/[id]/_components/PlayerGrid";

export const dynamic = "force-dynamic";

/**
 * Table-admin scoped view. Audience is a single table — either a
 * global admin who wants to focus on one corner of the room, or the
 * player seated there acting as the table admin for outs / color-ups
 * / chip-count edits.
 *
 * Reuses `PlayerGrid` from the main admin page (filtered to this
 * table's roster only) and `ColorUpInbox` (filtered to pending
 * requests from players at this table). Actions are gated server-side
 * by `requireManagePlayerSlot`, so the buttons render the same for
 * everyone but only work for authorized callers.
 */
export default async function TableAdminPage({
  params,
}: {
  params: Promise<{ tournamentId: string; tableNumber: string }>;
}) {
  const { tournamentId, tableNumber: tableNumberStr } = await params;
  const tableNumber = Number.parseInt(tableNumberStr, 10);
  if (!Number.isFinite(tableNumber) || tableNumber < 1) notFound();

  const ctx = await getAuthContext();
  if (!ctx) redirect(`/auth/login?next=/table/${tournamentId}/${tableNumber}`);

  // Authorization: global admin → always allowed. Otherwise the user
  // must be seated at exactly this (tournament, table).
  if (!ctx.isGlobalAdmin) {
    const seat = ctx.seatedTable;
    if (
      !seat ||
      seat.tournament_id !== tournamentId ||
      seat.table_number !== tableNumber
    ) {
      redirect("/");
    }
  }

  // Reads use the service client so non-admin table admins can still
  // see other players' names via the `players` join (the admin-only
  // RLS on `players` otherwise hides every row except their own).
  const supabase = createServiceClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", tournamentId)
    .maybeSingle<Tables<"tournaments">>();
  if (!tournament) notFound();

  const tablesCfg = resolveTablesConfig({
    tablesConfig: tournament.tables_config,
    numTables: tournament.num_tables,
    maxSeatsPerTable: tournament.max_seats_per_table,
  });
  const tableCfg = tablesCfg[tableNumber - 1];
  if (!tableCfg) notFound();

  const css = TABLE_COLOR_CSS[tableCfg.color] ?? TABLE_COLOR_CSS.gold;

  const [rosterRes, pendingColorUpsRes, snapshotEventsRes] = await Promise.all([
    supabase
      .from("tournament_players")
      .select("*, player:players(id, name, signal_handle)")
      .eq("tournament_id", tournamentId)
      .order("seat_number", { ascending: true, nullsFirst: false }),
    supabase
      .from("color_up_requests")
      .select("*, player:players(id, name)")
      .eq("tournament_id", tournamentId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("tournament_events")
      .select("type, payload, created_at")
      .eq("tournament_id", tournamentId)
      .eq("type", "chip_snapshot")
      .order("created_at", { ascending: true }),
  ]);
  const roster = (rosterRes.data ?? []) as TournamentRosterRow[];
  const pendingColorUps = (pendingColorUpsRes.data ?? []) as Array<
    ColorUpRequest & { player: Pick<Player, "id" | "name"> | null }
  >;

  const snapshotEvents = (snapshotEventsRes.data ?? []) as ChipSnapshotEvent[];
  const latestSnapshotByPlayer = latestChipSnapshotPerPlayer(snapshotEvents);

  // Scope to this table. Busted players with their last seat on this
  // table also belong here so their "Out · Lx" tile shows in the same
  // place an admin would look for it (matches the main /admin grid).
  const atTable = roster.filter((r) => r.table_number === tableNumber);
  const inPlay = atTable.filter((r) => !r.busted_at_time);
  const out = atTable.filter((r) => r.busted_at_time);

  // Seating banner: trips when any active player at the table has
  // a null seat_confirmed_at (first sign-in OR after a system reseat
  // from balance / merge / move). The link routes to the editor; the
  // banner clears as soon as the table admin saves.
  const seatsNeedConfirmation = inPlay.some(
    (r) => r.seat_confirmed_at == null,
  );

  // Color-up inbox: only requests from players currently seated at
  // this table. Look up player_id → table_number via the roster
  // we already fetched.
  const playerIdsAtTable = new Set(
    atTable.map((r) => r.player_id).filter(Boolean) as string[],
  );
  const myColorUps = pendingColorUps.filter(
    (r) => r.player_id && playerIdsAtTable.has(r.player_id),
  );

  const buybackCfg = tournament.buyback_config_snapshot as {
    rebuyAllowedThroughLevel?: number;
    addOnAtBreakLevel?: number;
  };
  const cur = currentLevel(tournament);

  // Active hand at this table? Drives the "Resume hand" vs "Start
  // hand" button label on the tracker entry.
  const { data: activeHand } = await supabase
    .from("hands")
    .select("id, hand_number, current_street")
    .eq("tournament_id", tournamentId)
    .eq("table_number", tableNumber)
    .eq("status", "active")
    .maybeSingle();

  return (
    <>
      <TopBar
        title={tableCfg.name ?? `Table ${tableNumber}`}
        subtitle={`${tournament.status.toUpperCase()} · ${formatBlinds(cur)}`}
        back={
          ctx.isGlobalAdmin
            ? { href: `/admin/tournaments/${tournamentId}`, label: "Tournament" }
            : { href: "/", label: "Home" }
        }
        action={
          <div className="flex items-center gap-2">
            {tournament.is_sandbox ? <SandboxBadge /> : null}
            <span
              className="rounded-md border px-3 py-2 text-[10px] font-semibold uppercase tracking-widest"
              style={{ borderColor: css.border, color: css.text }}
            >
              {ctx.isGlobalAdmin ? "Admin" : "Table admin"}
            </span>
          </div>
        }
      />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <section
          className="rounded-lg border-2 p-4"
          style={{ borderColor: css.border, background: css.bg }}
        >
          <p
            className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]"
            style={{ color: css.text }}
          >
            {tableCfg.name ?? `Table ${tableNumber}`}
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {cur?.is_break ? "Break" : formatBlinds(cur)}
          </p>
          <p className="mt-1 text-xs text-fg/60">
            {inPlay.length} in play · {out.length} out · {tableCfg.max_seats}{" "}
            seats
          </p>
        </section>

        {seatsNeedConfirmation ? (
          <section className="flex items-center gap-3 rounded-lg border border-gold bg-gold/10 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em] text-gold">
                Seats need confirmation
              </p>
              <p className="mt-0.5 text-xs text-fg/70">
                The system assigned seats — please confirm who is
                physically sitting where before you start a hand.
              </p>
            </div>
            <Link
              href={`/table/${tournamentId}/${tableNumber}/seats`}
              className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md bg-gold px-4 text-xs font-semibold uppercase tracking-wider text-bg"
            >
              Confirm
            </Link>
          </section>
        ) : null}

        <section className="flex items-center gap-3 rounded-lg border border-fg/15 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              {activeHand ? "Hand in progress" : "Hand tracker"}
            </p>
            <p className="mt-0.5 text-xs text-fg/55">
              {activeHand
                ? `Hand #${activeHand.hand_number} · ${activeHand.current_street}`
                : "Log every fold / call / bet / raise. Blinds auto-post, pot auto-awards."}
            </p>
          </div>
          <Link
            href={`/table/${tournamentId}/${tableNumber}/hand`}
            className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md bg-gold px-4 text-xs font-semibold uppercase tracking-wider text-bg"
          >
            {activeHand ? "Resume" : "Start hand"}
          </Link>
        </section>

        <section className="flex items-center gap-3 rounded-lg border border-fg/10 p-3">
          <div className="min-w-0 flex-1">
            <p className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              Seating
            </p>
            <p className="mt-0.5 text-xs text-fg/55">
              Rearrange physical seats any time.
            </p>
          </div>
          <Link
            href={`/table/${tournamentId}/${tableNumber}/seats`}
            className="inline-flex h-11 min-h-[44px] items-center justify-center rounded-md border border-fg/15 px-4 text-xs font-semibold uppercase tracking-wider text-fg/80"
          >
            Edit seats
          </Link>
        </section>

        <ChipSnapshotPanel
          tournamentId={tournamentId}
          tableNumber={tableNumber}
          players={inPlay
            .filter((r) => r.player)
            .map((r) => ({
              tournamentPlayerId: r.id,
              name: r.player?.name ?? "—",
              currentChips: r.current_chips,
            }))}
        />

        {myColorUps.length > 0 ? (
          <section className="rounded-lg border border-gold/40 bg-gold/5 p-3">
            <h2 className="text-label mb-2 text-[11px] font-semibold uppercase tracking-[0.25em]">
              Color-up inbox · {myColorUps.length}
            </h2>
            <ColorUpInbox requests={myColorUps} />
          </section>
        ) : null}

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-label text-[11px] font-semibold uppercase tracking-[0.25em]">
              In play · {inPlay.length}
            </h2>
          </div>
          <PlayerGrid
            currentLevel={tournament.current_level}
            buybackConfig={buybackCfg}
            scope={ctx.isGlobalAdmin ? "admin" : "table"}
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
              scope={ctx.isGlobalAdmin ? "admin" : "table"}
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
      </main>
    </>
  );
}
