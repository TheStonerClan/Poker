"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireManageTable } from "@/lib/auth/table-admin";
import { resolveTablesConfig } from "@/lib/admin/tables";
import { createServiceClient } from "@/lib/supabase/service";

export type SeatActionResult = { ok: true } | { ok: false; error: string };

async function runScoped(
  fn: () => Promise<void>,
): Promise<SeatActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "Unknown server error";
    return { ok: false, error: message };
  }
}

async function refresh(tournamentId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/tournaments/${tournamentId}`);
  revalidatePath(`/table/${tournamentId}`, "layout");
  revalidatePath("/tv");
}

const ConfirmSeatingSchema = z.object({
  tournamentId: z.uuid(),
  tableNumber: z.number().int().min(1),
  assignments: z
    .array(
      z.object({
        tournamentPlayerId: z.uuid(),
        seatNumber: z.number().int().min(1),
      }),
    )
    .min(1, "Pick at least one seat assignment."),
});

/**
 * Confirm (or rearrange) seating at a single table. The table admin
 * sees a per-player picker on `/table/[tid]/[n]/seats`; this action
 * applies the new layout in a two-phase write so the partial unique
 * index on (tournament_id, table_number, seat_number) doesn't reject
 * any seat swap.
 *
 * Stamps `seat_confirmed_at = now()` on every active player at the
 * table — even those whose seat number didn't change, since the
 * admin's act of saving IS the confirmation.
 *
 * Rejects when:
 *   - A player in the payload isn't currently at this table.
 *   - Two players are assigned to the same seat.
 *   - A seat number exceeds the table's `max_seats`.
 *   - An active hand is in progress at the table (don't reseat mid-hand).
 */
export async function confirmTableSeating(input: {
  tournamentId: string;
  tableNumber: number;
  assignments: Array<{ tournamentPlayerId: string; seatNumber: number }>;
}): Promise<SeatActionResult> {
  return runScoped(async () => {
    const parsed = ConfirmSeatingSchema.parse(input);
    await requireManageTable({
      tournamentId: parsed.tournamentId,
      tableNumber: parsed.tableNumber,
    });
    const supabase = createServiceClient();

    // Pull tournament for table config + verify status.
    const { data: tournament, error: tErr } = await supabase
      .from("tournaments")
      .select(
        "id, status, num_tables, max_seats_per_table, tables_config",
      )
      .eq("id", parsed.tournamentId)
      .single();
    if (tErr || !tournament) {
      throw new Error(tErr?.message ?? "Tournament not found.");
    }
    if (
      tournament.status === "finished" ||
      tournament.status === "cancelled"
    ) {
      throw new Error(
        `Can't change seats — tournament is ${tournament.status}.`,
      );
    }

    const tablesCfg = resolveTablesConfig({
      tablesConfig: tournament.tables_config,
      numTables: tournament.num_tables,
      maxSeatsPerTable: tournament.max_seats_per_table,
    });
    const cfg = tablesCfg[parsed.tableNumber - 1];
    if (!cfg) throw new Error("Table not configured for this tournament.");
    const maxSeats = cfg.max_seats;

    // Block on an active hand at this table — reseating mid-hand
    // would scramble the hand's snapshot of (seat, player).
    const { data: liveHand } = await supabase
      .from("hands")
      .select("id")
      .eq("tournament_id", parsed.tournamentId)
      .eq("table_number", parsed.tableNumber)
      .eq("status", "active")
      .maybeSingle();
    if (liveHand) {
      throw new Error(
        "A hand is in progress at this table. Finish or cancel it first.",
      );
    }

    // Validate payload shape — no duplicate seats, every seat in
    // range, every player listed actually belongs to this table.
    const seenSeats = new Set<number>();
    for (const a of parsed.assignments) {
      if (a.seatNumber > maxSeats) {
        throw new Error(
          `Seat ${a.seatNumber} exceeds ${cfg.name ?? `Table ${parsed.tableNumber}`}'s cap of ${maxSeats}.`,
        );
      }
      if (seenSeats.has(a.seatNumber)) {
        throw new Error(
          `Seat ${a.seatNumber} is assigned to more than one player.`,
        );
      }
      seenSeats.add(a.seatNumber);
    }

    const { data: rows } = await supabase
      .from("tournament_players")
      .select("id, table_number, busted_at_time")
      .eq("tournament_id", parsed.tournamentId)
      .eq("table_number", parsed.tableNumber);
    const tableRows = rows ?? [];
    const activeRowIds = new Set(
      tableRows
        .filter((r) => r.busted_at_time == null)
        .map((r) => r.id),
    );

    for (const a of parsed.assignments) {
      if (!activeRowIds.has(a.tournamentPlayerId)) {
        throw new Error(
          "One of the picked players isn't active at this table.",
        );
      }
    }

    // Two-phase write: clear seats first so the partial unique index
    // doesn't reject the swap. Only touch the assigned rows — we
    // leave busted players' historical seat_number intact (they may
    // already be null from the bust flow).
    const ids = parsed.assignments.map((a) => a.tournamentPlayerId);
    const { error: clearErr } = await supabase
      .from("tournament_players")
      .update({ seat_number: null })
      .in("id", ids);
    if (clearErr) throw new Error(clearErr.message);

    const nowIso = new Date().toISOString();
    for (const a of parsed.assignments) {
      const { error: upErr } = await supabase
        .from("tournament_players")
        .update({
          seat_number: a.seatNumber,
          seat_confirmed_at: nowIso,
          // Refresh table_number defensively in case the row was
          // racing with a move (no-op for the typical case).
          table_number: parsed.tableNumber,
        })
        .eq("id", a.tournamentPlayerId);
      if (upErr) throw new Error(upErr.message);
    }

    // Log the confirmation for the audit trail. tournament_events is
    // public read, so historians can later see who reseated when.
    await supabase.from("tournament_events").insert({
      tournament_id: parsed.tournamentId,
      type: "admin_note",
      payload: {
        kind: "seat_confirmation",
        table_number: parsed.tableNumber,
        assignments: parsed.assignments.map((a) => ({
          tournament_player_id: a.tournamentPlayerId,
          seat_number: a.seatNumber,
        })),
      },
    });

    await refresh(parsed.tournamentId);
  });
}
