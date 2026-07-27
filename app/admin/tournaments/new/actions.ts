"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { resolveBounty } from "@/lib/admin/bounty";
import { createClient } from "@/lib/supabase/server";
import {
  randomizeAssignments,
  TABLE_COLORS,
  type TableColor,
  type TableConfig,
} from "@/lib/admin/tables";
import { toIsoDate } from "@/lib/schedule/next-night";
import { resolveNextNight } from "@/lib/schedule/server";
import {
  isValidHhMm,
  isValidTimezone,
  localDateInTz,
  splitHhMm,
  zonedWallClockToUtc,
} from "@/lib/schedule/zoned-time";

const TableEntrySchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(TABLE_COLORS as readonly [TableColor, ...TableColor[]]),
  max_seats: z.coerce.number().int().min(2).max(10),
});

const StartSchema = z.object({
  templateId: z.uuid(),
  playerIds: z.array(z.uuid()).min(2, "Pick at least two players."),
  tables: z.array(TableEntrySchema).min(1).max(10),
});

export type StartTournamentResult = {
  status: "ok" | "error";
  message?: string;
};

export async function startTournament(
  input: {
    templateId: string;
    playerIds: string[];
    tables: TableConfig[];
  },
  opts?: { isSandbox?: boolean },
): Promise<StartTournamentResult> {
  await requireAdmin();
  const isSandbox = opts?.isSandbox ?? false;
  const parsed = StartSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const { templateId, playerIds, tables } = parsed.data;
  const totalSeats = tables.reduce((s, t) => s + t.max_seats, 0);
  if (playerIds.length > totalSeats) {
    return {
      status: "error",
      message: `${playerIds.length} players don't fit in ${totalSeats} configured seats. Add a table or raise a seat cap.`,
    };
  }
  const supabase = await createClient();

  const { data: template, error: tplErr } = await supabase
    .from("tournament_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();
  if (tplErr || !template) {
    return { status: "error", message: tplErr?.message ?? "Template not found" };
  }

  // Compute the planned start instant. Two reasons we set it instead
  // of leaving null:
  //
  //   1. The upcoming-list dedupe in lib/admin/upcoming.ts needs
  //      `scheduled_at` to know this row already covers an occurrence
  //      date — without it, the recurrence projection keeps showing up
  //      alongside the materialized tournament and routes the admin
  //      back here.
  //
  //   2. It's a real timestamp for sorting, history queries, and the
  //      "Tonight, 7 PM CDT" home-page formatter.
  //
  // The logic mirrors lib/admin/upcoming.ts so a projection's date and
  // the materialized scheduled_at agree.
  let scheduledAt: string;
  let scheduledLocalDate: string | null = null;
  if (template.recurrence_rule) {
    const next = await resolveNextNight(supabase, template);
    if (next.kind === "ok") {
      scheduledLocalDate = toIsoDate(next.next.effectiveDate);
      if (
        template.start_time &&
        template.start_timezone &&
        isValidHhMm(template.start_time) &&
        isValidTimezone(template.start_timezone)
      ) {
        const [hour, minute] = splitHhMm(template.start_time);
        const utc = zonedWallClockToUtc(
          next.next.effectiveDate.getFullYear(),
          next.next.effectiveDate.getMonth() + 1,
          next.next.effectiveDate.getDate(),
          hour,
          minute,
          template.start_timezone,
        );
        scheduledAt = utc.toISOString();
      } else {
        // Recurrence-only, no time-of-day. Noon UTC of the local date
        // keeps the calendar date stable in any common zone.
        scheduledAt = `${scheduledLocalDate}T12:00:00Z`;
      }
    } else {
      scheduledAt = new Date().toISOString();
    }
  } else {
    scheduledAt = new Date().toISOString();
  }

  // Forgiving guard: if the admin already created a scheduled
  // tournament for this template+date, send them to the detail page
  // instead of erroring with "another tournament is already active" or
  // (worse) duplicating the row. Catches stale projection-click links
  // that survive a cache or race.
  if (scheduledLocalDate) {
    const { data: existingForDate } = await supabase
      .from("tournaments")
      .select("id, scheduled_at")
      .eq("template_id", template.id)
      .eq("status", "scheduled")
      .eq("is_sandbox", isSandbox);
    const match = (existingForDate ?? []).find((row) => {
      if (!row.scheduled_at) return false;
      const rowDate =
        template.start_timezone && isValidTimezone(template.start_timezone)
          ? localDateInTz(new Date(row.scheduled_at), template.start_timezone)
          : row.scheduled_at.slice(0, 10);
      return rowDate === scheduledLocalDate;
    });
    if (match) {
      redirect(`/admin/tournaments/${match.id}`);
    }
  }

  // Only-one-active guard for the remaining case: no scheduled row for
  // this template+date, but something else is running/paused/scheduled
  // and would conflict with starting another.
  const { data: active } = await supabase
    .from("tournaments")
    .select("id")
    .in("status", ["scheduled", "running", "paused"])
    .eq("is_sandbox", isSandbox)
    .limit(1);
  if (active && active.length > 0) {
    return {
      status: "error",
      message: isSandbox
        ? "Another sandbox tournament is already active. Finalize it first."
        : "Another tournament is already active. Finalize it first.",
    };
  }

  const { data: structure, error: bsErr } = await supabase
    .from("blind_structures")
    .select("levels")
    .eq("id", template.blind_structure_id)
    .maybeSingle();
  if (bsErr || !structure) {
    return { status: "error", message: bsErr?.message ?? "Blind structure not found" };
  }

  const { data: tournament, error: insErr } = await supabase
    .from("tournaments")
    .insert({
      template_id: template.id,
      status: "scheduled",
      is_sandbox: isSandbox,
      scheduled_at: scheduledAt,
      buy_in_snapshot: template.buy_in,
      starting_stack_snapshot: template.starting_stack,
      max_rebuys_snapshot: template.max_rebuys,
      rebuy_price_snapshot: template.rebuy_price,
      rebuy_chips_snapshot: template.rebuy_chips,
      ante_mode_snapshot: template.ante_mode,
      buyback_config_snapshot: template.buyback_config,
      side_pots_snapshot: template.side_pots,
      rounding_mode_snapshot: template.rounding_mode,
      prize_rules_snapshot: template.prize_rules,
      chip_denominations_snapshot: template.chip_denominations,
      starting_stack_composition_snapshot: template.starting_stack_composition,
      blind_structure_snapshot: structure.levels,
      current_level: 1,
      // Legacy fields kept for backward compat with any reader that
      // hasn't been updated to honor tables_config. Set to the count
      // of tables and the max max_seats so a fallback resolution still
      // gives the right shape.
      num_tables: tables.length,
      max_seats_per_table: Math.max(...tables.map((t) => t.max_seats)),
      tables_config: tables,
    })
    .select("id")
    .single();
  if (insErr || !tournament) {
    return { status: "error", message: insErr?.message ?? "Could not create tournament" };
  }

  // Randomize the roster onto (table, seat) before inserting. The
  // helper greedily assigns to whichever table has the most remaining
  // capacity, so stragglers naturally land at larger tables when caps
  // are uneven.
  const assignments = randomizeAssignments({ playerIds, tables });
  const tpRows = assignments.map((a) => ({
    tournament_id: tournament.id,
    player_id: a.player_id,
    table_number: a.table_number,
    seat_number: a.seat_number,
    current_chips: template.starting_stack,
  }));

  const { error: tpErr } = await supabase.from("tournament_players").insert(tpRows);
  if (tpErr) {
    // Roll back the tournament so the admin can retry. We're not in a tx, but
    // this keeps state consistent in the common case.
    await supabase.from("tournaments").delete().eq("id", tournament.id);
    return { status: "error", message: tpErr.message };
  }

  // Resolve the bounty (target + stacked amount) once, now that the
  // roster is settled. Best-effort: a lookup failure here shouldn't
  // block starting the tournament, it just means no bounty shows tonight.
  const bounty = await resolveBounty({
    isSandbox,
    rosterPlayerIds: playerIds,
  }).catch(() => null);
  if (bounty) {
    await supabase
      .from("tournaments")
      .update({
        bounty_target_player_id: bounty.targetPlayerId,
        bounty_amount: bounty.amount,
      })
      .eq("id", tournament.id);
  }

  revalidatePath(isSandbox ? "/sandboxadmin" : "/admin");
  redirect(`/admin/tournaments/${tournament.id}`);
}
