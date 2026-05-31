import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";
import { computeElapsedMs } from "@/lib/timer/elapsed";
import { getLevel, parseLevels } from "@/lib/tv/levels";

/**
 * Auto-advance the tournament to the next level, fired by the TV when
 * its local clock hits zero. The endpoint is intentionally callable
 * without admin auth — the TV is a trust-the-display surface — but the
 * server enforces every constraint that admin actions enforce, plus a
 * few extras specific to the auto-advance use case:
 *
 * 1. Tournament must be `running`. (Paused / scheduled / finished can't
 *    auto-advance — admin owns those transitions.)
 * 2. Caller's `expectedLevel` must match the row's `current_level`.
 *    Defends against stale TVs whose local state lags the DB by more
 *    than the drift-sync interval — without this, a TV recovering from
 *    a network blip could double-advance.
 * 3. Current level must NOT be a break. Breaks are admin-paced — the
 *    operator decides when players are back in their seats. The TV
 *    never auto-advances past a break.
 * 4. Server-computed elapsed time must be ≥ the level's duration.
 *    Belt-and-suspenders against client clock skew.
 *
 * The actual UPDATE filters on `current_level=expectedLevel`, so even if
 * five TVs fire simultaneously only the first lands the write. Losers
 * see 0 affected rows and silently no-op.
 */

const GRACE_MS = 500; // tolerate sub-second client/server drift

export async function POST(
  req: Request,
  ctx: { params: Promise<{ tournamentId: string }> },
) {
  const { tournamentId } = await ctx.params;

  let body: { expectedLevel?: number };
  try {
    body = (await req.json()) as { expectedLevel?: number };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const expectedLevel = body.expectedLevel;
  if (typeof expectedLevel !== "number" || !Number.isFinite(expectedLevel)) {
    return NextResponse.json(
      { error: "expectedLevel required" },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();

  const { data: t, error: fetchErr } = await supabase
    .from("tournaments")
    .select(
      "id, status, current_level, level_started_at, level_paused_at, accumulated_pause_ms, blind_structure_snapshot",
    )
    .eq("id", tournamentId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!t) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (t.status !== "running") {
    return NextResponse.json(
      { advanced: false, reason: "not running" },
      { status: 200 },
    );
  }
  if (t.current_level !== expectedLevel) {
    return NextResponse.json(
      { advanced: false, reason: "level changed" },
      { status: 200 },
    );
  }

  const levels = parseLevels(t.blind_structure_snapshot);
  const cur = getLevel(levels, t.current_level);
  if (!cur) {
    return NextResponse.json(
      { error: "level not found in structure" },
      { status: 500 },
    );
  }
  // Breaks are admin-paced. The auto-advance never crosses a break —
  // the operator decides when players are settled and ready for the
  // next level. (If the caller mistakenly fires here, just no-op.)
  if (cur.is_break) {
    return NextResponse.json(
      { advanced: false, reason: "break" },
      { status: 200 },
    );
  }

  // Server-side elapsed check — never trust the client's clock alone.
  const elapsedMs = computeElapsedMs(
    {
      status: t.status,
      durationSec: cur.duration_sec,
      levelStartedAt: t.level_started_at,
      levelPausedAt: t.level_paused_at,
      accumulatedPauseMs: t.accumulated_pause_ms ?? 0,
    },
    Date.now(),
  );
  if (elapsedMs + GRACE_MS < cur.duration_sec * 1000) {
    return NextResponse.json(
      { advanced: false, reason: "not expired", elapsedMs },
      { status: 200 },
    );
  }

  const max = levels.reduce((m, l) => (l.level_num > m ? l.level_num : m), 0);
  const nextLevel = Math.min(t.current_level + 1, max);
  if (nextLevel === t.current_level) {
    return NextResponse.json(
      { advanced: false, reason: "at last level" },
      { status: 200 },
    );
  }

  const now = new Date().toISOString();
  // Atomic CAS: filter on the level we read so concurrent callers from
  // multiple TVs can't double-advance. Losers get 0 rows back.
  const { data: updated, error: updErr } = await supabase
    .from("tournaments")
    .update({
      current_level: nextLevel,
      level_started_at: now,
      level_paused_at: null,
      accumulated_pause_ms: 0,
    })
    .eq("id", tournamentId)
    .eq("current_level", expectedLevel)
    .select("id")
    .maybeSingle();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }
  if (!updated) {
    // Another caller already advanced. Idempotent no-op.
    return NextResponse.json(
      { advanced: false, reason: "race lost" },
      { status: 200 },
    );
  }

  await supabase.from("tournament_events").insert({
    tournament_id: tournamentId,
    type: "level_advance",
    payload: {
      from_level: expectedLevel,
      to_level: nextLevel,
      auto: true,
    },
  });

  return NextResponse.json({ advanced: true, toLevel: nextLevel });
}
