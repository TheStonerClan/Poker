"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireManageTable } from "@/lib/auth/table-admin";
import { createServiceClient } from "@/lib/supabase/service";

export type ChipSnapshotActionResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

async function runScoped(
  fn: () => Promise<number>,
): Promise<ChipSnapshotActionResult> {
  try {
    const count = await fn();
    return { ok: true, count };
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

const SubmitTableChipSnapshotsSchema = z.object({
  tournamentId: z.uuid(),
  tableNumber: z.number().int().min(1),
  entries: z
    .array(
      z.object({
        tournamentPlayerId: z.uuid(),
        chips: z.number().int().min(0),
      }),
    )
    .min(1, "Enter at least one player's chip count."),
});

/**
 * Bulk break-checkpoint chip count for every player at a table, logged
 * as one `chip_snapshot` event per player — the same event shape
 * /play's self-report writes, so /history's break-shift analytics pick
 * these up with no changes on that side.
 *
 * Exists because in practice the table admin (or the head admin,
 * making the rounds) is the one calling out stacks, not each player
 * self-reporting — the single-player /play screen doesn't scale to a
 * full table during a live break. Unlike that flow, this one is NOT
 * restricted to break levels: it's also used at the final table, which
 * may land mid-level rather than on a scheduled break.
 */
export async function submitTableChipSnapshots(input: {
  tournamentId: string;
  tableNumber: number;
  entries: Array<{ tournamentPlayerId: string; chips: number }>;
}): Promise<ChipSnapshotActionResult> {
  return runScoped(async () => {
    const parsed = SubmitTableChipSnapshotsSchema.parse(input);
    const ctx = await requireManageTable({
      tournamentId: parsed.tournamentId,
      tableNumber: parsed.tableNumber,
    });

    const supabase = createServiceClient();

    const { data: tournament, error: tErr } = await supabase
      .from("tournaments")
      .select("current_level, status")
      .eq("id", parsed.tournamentId)
      .maybeSingle();
    if (tErr || !tournament) throw new Error("Tournament not found.");
    if (tournament.status === "finished" || tournament.status === "cancelled") {
      throw new Error(
        `Chip counts are only allowed while the tournament is active (currently ${tournament.status}).`,
      );
    }

    // Refetch this table's roster server-side rather than trusting the
    // client's (tournamentId, tableNumber) pairing for each entry — a
    // table admin can only ever write rows this query actually returns.
    const { data: rows, error: rowsErr } = await supabase
      .from("tournament_players")
      .select("id, player_id, current_chips, busted_at_time")
      .eq("tournament_id", parsed.tournamentId)
      .eq("table_number", parsed.tableNumber);
    if (rowsErr) throw new Error(rowsErr.message);
    const byId = new Map((rows ?? []).map((r) => [r.id, r]));

    const events: Array<{
      tournament_id: string;
      type: "chip_snapshot";
      payload: {
        player_id: string;
        level_num: number;
        chips: number;
        previous_chips: number;
        delta: number;
        reported_by: "admin" | "table_admin";
      };
    }> = [];
    for (const entry of parsed.entries) {
      const row = byId.get(entry.tournamentPlayerId);
      // Silently skip anything that isn't a live player at this table
      // (busted since the panel loaded, moved tables, or a stale id) —
      // one skipped row shouldn't fail the whole batch.
      if (!row || row.busted_at_time || !row.player_id) continue;

      const previous = row.current_chips ?? 0;
      const { error: upErr } = await supabase
        .from("tournament_players")
        .update({ current_chips: entry.chips })
        .eq("id", entry.tournamentPlayerId);
      if (upErr) throw new Error(upErr.message);

      events.push({
        tournament_id: parsed.tournamentId,
        type: "chip_snapshot",
        payload: {
          player_id: row.player_id,
          level_num: tournament.current_level,
          chips: entry.chips,
          previous_chips: previous,
          delta: entry.chips - previous,
          reported_by: ctx.isGlobalAdmin ? "admin" : "table_admin",
        },
      });
    }

    if (events.length === 0) return 0;

    const { error: insErr } = await supabase
      .from("tournament_events")
      .insert(events);
    if (insErr) throw new Error(insErr.message);

    await refresh(parsed.tournamentId);
    return events.length;
  });
}
