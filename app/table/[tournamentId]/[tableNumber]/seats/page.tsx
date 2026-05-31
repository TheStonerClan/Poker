import { notFound, redirect } from "next/navigation";

import { TopBar } from "@/components/admin/TopBar";
import { getAuthContext } from "@/lib/auth/table-admin";
import { resolveTablesConfig, TABLE_COLOR_CSS } from "@/lib/admin/tables";
import { createServiceClient } from "@/lib/supabase/service";
import type { Tables } from "@/lib/database.types";

import { SeatEditor } from "./_components/SeatEditor";

export const dynamic = "force-dynamic";

/**
 * Seat-confirmation editor. The table admin lands here from the
 * "Seats need confirmation" banner on `/table/[tid]/[n]` (or any
 * time they want to physically rearrange the room).
 *
 * Lists every active player at the table; each gets a dropdown to
 * pick which physical seat (1..max_seats) they're sitting at. Save
 * commits the layout atomically + stamps seat_confirmed_at = now()
 * so the banner clears.
 */
export default async function SeatEditorPage({
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
      `/auth/login?next=/table/${tournamentId}/${tableNumber}/seats`,
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

  const { data: rosterRaw } = await supabase
    .from("tournament_players")
    .select(
      "id, seat_number, table_number, busted_at_time, seat_confirmed_at, player:players(id, name)",
    )
    .eq("tournament_id", tournamentId)
    .eq("table_number", tableNumber)
    .is("busted_at_time", null);

  type RosterRow = {
    id: string;
    seat_number: number | null;
    table_number: number | null;
    busted_at_time: string | null;
    seat_confirmed_at: string | null;
    player: { id: string; name: string } | null;
  };
  const roster = (rosterRaw ?? []) as RosterRow[];

  // Block on an active hand so the admin doesn't reseat mid-hand —
  // the same guard the server action enforces, surfaced here so the
  // UI is honest about why "Save" wouldn't work.
  const { data: activeHand } = await supabase
    .from("hands")
    .select("id, hand_number")
    .eq("tournament_id", tournamentId)
    .eq("table_number", tableNumber)
    .eq("status", "active")
    .maybeSingle();

  return (
    <>
      <TopBar
        title={`${tableCfg.name ?? `Table ${tableNumber}`} · Seats`}
        subtitle="Confirm physical seating"
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
          <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
            A hand is in progress (#{activeHand.hand_number}). Finish or
            cancel it before reseating.
          </p>
        ) : null}
        <SeatEditor
          tournamentId={tournamentId}
          tableNumber={tableNumber}
          maxSeats={tableCfg.max_seats}
          players={roster.map((r) => ({
            tournamentPlayerId: r.id,
            name: r.player?.name ?? "—",
            currentSeat: r.seat_number ?? null,
            confirmed: r.seat_confirmed_at != null,
          }))}
          locked={Boolean(activeHand)}
        />
      </main>
    </>
  );
}
