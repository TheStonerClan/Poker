import { notFound, redirect } from "next/navigation";

import { TopBar } from "@/components/admin/TopBar";
import { getAuthContext } from "@/lib/auth/table-admin";
import { formatBlinds } from "@/lib/admin/format";
import {
  STREETS,
  computePotStructure,
  deriveHandState,
  pickNextDealer,
  type Hand,
  type HandAction,
  type HandSeat,
  type Street,
} from "@/lib/admin/hand";
import {
  blindLevels,
  currentLevel,
  type BlindLevel,
} from "@/lib/admin/queries";
import { createServiceClient } from "@/lib/supabase/service";
import { resolveTablesConfig, TABLE_COLOR_CSS } from "@/lib/admin/tables";
import type { Tables } from "@/lib/database.types";

import { LiveHandPanel } from "./_components/LiveHandPanel";
import { ShowdownPanel } from "./_components/ShowdownPanel";
import { StartHandPanel } from "./_components/StartHandPanel";

export const dynamic = "force-dynamic";

/**
 * Live hand tracker. Three states the page can be in:
 *   1. No active hand → render `StartHandPanel`, which previews the
 *      proposed dealer / SB / BB (auto-rotated from the previous
 *      hand) and lets the admin override before kicking off.
 *   2. Active hand on a betting street → render `LiveHandPanel` with
 *      pot/current-bet/whose-turn + action buttons for the active
 *      seat. The post-action helper auto-advances streets when bets
 *      match all the way around.
 *   3. Active hand in showdown → render `ShowdownPanel` with one
 *      winner-picker per pot (handles side pots).
 *
 * Auth: same as the table page — global admin or the player seated
 * at this exact table.
 */
export default async function HandTrackerPage({
  params,
}: {
  params: Promise<{ tournamentId: string; tableNumber: string }>;
}) {
  const { tournamentId, tableNumber: tableNumberStr } = await params;
  const tableNumber = Number.parseInt(tableNumberStr, 10);
  if (!Number.isFinite(tableNumber) || tableNumber < 1) notFound();

  const ctx = await getAuthContext();
  if (!ctx) {
    redirect(
      `/auth/login?next=/table/${tournamentId}/${tableNumber}/hand`,
    );
  }
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

  // Roster snapshot — needed for both the no-active-hand "preview"
  // and the active-hand seat-label rendering.
  const { data: rosterRaw } = await supabase
    .from("tournament_players")
    .select(
      "id, seat_number, table_number, current_chips, busted_at_time, player:players!tournament_players_player_id_fkey(id, name)",
    )
    .eq("tournament_id", tournamentId)
    .eq("table_number", tableNumber);
  type RosterRow = {
    id: string;
    seat_number: number | null;
    table_number: number | null;
    current_chips: number;
    busted_at_time: string | null;
    player: { id: string; name: string } | null;
  };
  const roster = (rosterRaw ?? []) as RosterRow[];
  const nameBySeat = new Map<number, string>();
  const nameByPlayerId = new Map<string, string>();
  for (const r of roster) {
    if (r.seat_number != null && r.player?.name) {
      nameBySeat.set(r.seat_number, r.player.name);
    }
    if (r.id && r.player?.name) {
      nameByPlayerId.set(r.id, r.player.name);
    }
  }

  // Active hand (at most one — enforced by partial unique index).
  const { data: activeHand } = await supabase
    .from("hands")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("table_number", tableNumber)
    .eq("status", "active")
    .maybeSingle<Hand>();

  // Used by StartHandPanel: previous hand to anchor auto-rotation.
  const { data: previousHand } = await supabase
    .from("hands")
    .select("dealer_seat, hand_number")
    .eq("tournament_id", tournamentId)
    .eq("table_number", tableNumber)
    .order("hand_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  const levels = blindLevels(tournament.blind_structure_snapshot);
  const cur = currentLevel(tournament);

  return (
    <>
      <TopBar
        title={`${tableCfg.name ?? `Table ${tableNumber}`} · Hand tracker`}
        subtitle={`${tournament.status.toUpperCase()} · ${formatBlinds(cur)}`}
        back={{
          href: `/table/${tournamentId}/${tableNumber}`,
          label: "Table",
        }}
        action={
          <span
            className="rounded-md border px-3 py-2 text-[10px] font-semibold uppercase tracking-widest"
            style={{ borderColor: css.border, color: css.text }}
          >
            {ctx.isGlobalAdmin ? "Admin" : "Table admin"}
          </span>
        }
      />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {activeHand ? (
          <ActiveHandView
            hand={activeHand}
            supabase={supabase}
            nameBySeat={nameBySeat}
            nameByPlayerId={nameByPlayerId}
            levels={levels}
          />
        ) : (
          <NoActiveHandView
            tournamentId={tournamentId}
            tableNumber={tableNumber}
            tournamentStatus={tournament.status}
            currentLevel={cur}
            roster={roster}
            previousDealerSeat={previousHand?.dealer_seat ?? null}
            nameBySeat={nameBySeat}
          />
        )}
      </main>
    </>
  );
}

async function ActiveHandView({
  hand,
  supabase,
  nameBySeat,
  nameByPlayerId,
  levels,
}: {
  hand: Hand;
  supabase: ReturnType<typeof createServiceClient>;
  nameBySeat: Map<number, string>;
  nameByPlayerId: Map<string, string>;
  levels: BlindLevel[];
}) {
  const [seatsRes, actionsRes] = await Promise.all([
    supabase
      .from("hand_seats")
      .select("*")
      .eq("hand_id", hand.id)
      .order("seat_number", { ascending: true }),
    supabase
      .from("hand_actions")
      .select("*")
      .eq("hand_id", hand.id)
      .order("created_at", { ascending: true }),
  ]);
  const seats = (seatsRes.data ?? []) as HandSeat[];
  const actions = (actionsRes.data ?? []) as HandAction[];

  const state = deriveHandState({ hand, seats, actions });

  // Stringify all snapshots into plain data so client components can
  // receive them without `undefined`-vs-`null` mismatches.
  const seatRows = seats.map((s) => ({
    seat_number: s.seat_number,
    tournament_player_id: s.tournament_player_id,
    name: nameBySeat.get(s.seat_number) ?? "—",
    starting_chips: s.starting_chips,
    current_chips: s.current_chips,
    total_contributed: s.total_contributed,
    is_folded: s.is_folded,
    is_all_in: s.is_all_in,
    contributed_this_street:
      state.streetState.get(s.seat_number)?.contributed_this_street ?? 0,
    has_acted_this_street:
      state.streetState.get(s.seat_number)?.has_acted_this_street ?? false,
    is_dealer: s.seat_number === hand.dealer_seat,
    is_sb: s.seat_number === hand.sb_seat,
    is_bb: s.seat_number === hand.bb_seat,
    is_next_to_act: s.seat_number === state.nextToActSeat,
  }));

  if (hand.current_street === "showdown") {
    const pots = computePotStructure(seats);
    return (
      <ShowdownPanel
        handId={hand.id}
        pot={state.pot}
        pots={pots.map((p) => ({
          kind: p.kind,
          amount: p.amount,
          eligible: p.eligible.map((id) => ({
            tournament_player_id: id,
            name: nameByPlayerId.get(id) ?? "—",
          })),
        }))}
      />
    );
  }

  const levelInfo = levels.find((l) => l.level_num === hand.level_num);

  return (
    <LiveHandPanel
      handId={hand.id}
      handNumber={hand.hand_number}
      tournamentId={hand.tournament_id}
      tableNumber={hand.table_number}
      level={{
        level_num: hand.level_num,
        small_blind: hand.small_blind,
        big_blind: hand.big_blind,
        ante: hand.ante,
        is_break: levelInfo?.is_break ?? false,
      }}
      currentStreet={hand.current_street as Street}
      streets={[...STREETS]}
      pot={state.pot}
      currentBet={state.currentBet}
      nextToActSeat={state.nextToActSeat}
      seats={seatRows}
      streetIsComplete={state.streetIsComplete}
    />
  );
}

function NoActiveHandView({
  tournamentId,
  tableNumber,
  tournamentStatus,
  currentLevel: cur,
  roster,
  previousDealerSeat,
  nameBySeat,
}: {
  tournamentId: string;
  tableNumber: number;
  tournamentStatus: string;
  currentLevel: BlindLevel | null;
  roster: Array<{
    id: string;
    seat_number: number | null;
    busted_at_time: string | null;
    current_chips: number;
    player: { id: string; name: string } | null;
  }>;
  previousDealerSeat: number | null;
  nameBySeat: Map<number, string>;
}) {
  const eligible = roster.filter(
    (r) =>
      r.busted_at_time == null &&
      r.seat_number != null &&
      (r.current_chips ?? 0) > 0,
  );
  const activeSeatNumbers = eligible
    .map((e) => e.seat_number as number)
    .sort((a, b) => a - b);

  const proposal = pickNextDealer({
    previousDealerSeat,
    activeSeatNumbers,
  });

  const canStart =
    tournamentStatus === "running" || tournamentStatus === "paused";
  const blockedReason = !canStart
    ? `Tournament is ${tournamentStatus} — start the timer first.`
    : eligible.length < 2
      ? `Need at least 2 active players at this table (currently ${eligible.length}).`
      : !cur || !cur.big || cur.big <= 0
        ? "Current level has no big blind."
        : null;

  return (
    <StartHandPanel
      tournamentId={tournamentId}
      tableNumber={tableNumber}
      proposal={proposal}
      activeSeats={activeSeatNumbers.map((sn) => ({
        seat_number: sn,
        name: nameBySeat.get(sn) ?? "—",
      }))}
      blindsPreview={
        cur && cur.big
          ? {
              small: cur.small ?? 0,
              big: cur.big,
              ante: cur.ante ?? 0,
              level_num: cur.level_num,
            }
          : null
      }
      blockedReason={blockedReason}
    />
  );
}
