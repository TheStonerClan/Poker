#!/usr/bin/env -S npx tsx
// Seeds the sandbox with a copy of the most recent real finished
// tournament, so history/recap/leaderboard features built against
// /sandboxadmin have at least one realistic "last game" to work with
// from the start, without waiting on someone to finish a sandbox game
// by hand.
//
// Additive-only: never deletes or mutates real rows. Idempotent by
// default — if a sandbox tournament already exists, it's a no-op
// unless --force is passed (which seeds another copy alongside it).
//
// Env required (load with `set -a; source .env.local; set +a`):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Usage:
//   npx tsx scripts/seed-sandbox-history.ts
//   npx tsx scripts/seed-sandbox-history.ts --force

/* eslint-disable @typescript-eslint/no-unused-vars -- destructuring is used
   throughout to drop DB-generated / stale columns (id, tournament_id, ...)
   before re-inserting a cloned row; the bound names are intentionally
   unused. */

import { createServiceClient } from "../lib/supabase/service";

async function main() {
  const force = process.argv.includes("--force");
  const supabase = createServiceClient();

  if (!force) {
    const { data: existing, error } = await supabase
      .from("tournaments")
      .select("id")
      .eq("is_sandbox", true)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`checking for existing sandbox rows: ${error.message}`);
    if (existing) {
      console.log(
        `A sandbox tournament already exists (${existing.id}). Nothing to do — pass --force to seed another copy anyway.`,
      );
      return;
    }
  }

  const { data: source, error: sourceErr } = await supabase
    .from("tournaments")
    .select("*")
    .eq("status", "finished")
    .eq("is_sandbox", false)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sourceErr) throw new Error(`finding a real finished tournament: ${sourceErr.message}`);
  if (!source) {
    throw new Error(
      "No real finished tournament found to copy. Finish at least one real tournament first, then re-run this script.",
    );
  }

  console.log(`Cloning tournament ${source.id} (finished ${source.finished_at}) into the sandbox...`);

  // Clone the tournament row itself: everything except id/created_at/
  // updated_at (DB-generated), with is_sandbox flipped on.
  const { id: _sourceId, created_at: _createdAt, updated_at: _updatedAt, ...sourceRest } = source;
  const { data: clone, error: cloneErr } = await supabase
    .from("tournaments")
    .insert({ ...sourceRest, is_sandbox: true })
    .select("id")
    .single();
  if (cloneErr || !clone) {
    throw new Error(`inserting cloned tournament: ${cloneErr?.message ?? "unknown error"}`);
  }
  const newTournamentId = clone.id;

  // tournament_players — new row ids, same player_id references (no
  // financial/account data lives on `players`, so reusing real roster
  // names is fine). Clear live-claim state since it's meaningless for
  // a pre-finished fixture.
  const { data: players, error: playersErr } = await supabase
    .from("tournament_players")
    .select("*")
    .eq("tournament_id", source.id);
  if (playersErr) throw new Error(`reading tournament_players: ${playersErr.message}`);
  if (players && players.length > 0) {
    const rows = players.map(({ id: _id, tournament_id: _tid, claimed_session_id: _csid, claimed_at: _ca, ...rest }) => ({
      ...rest,
      tournament_id: newTournamentId,
      claimed_session_id: null,
      claimed_at: null,
    }));
    const { error } = await supabase.from("tournament_players").insert(rows);
    if (error) throw new Error(`cloning tournament_players: ${error.message}`);
  }

  // tournament_events — verbatim payloads. Every history/recap consumer
  // reads `payload.player_id` (a `players` row, preserved above), never
  // `payload.tournament_player_id`, so retargeting tournament_id is the
  // only change needed.
  const { data: events, error: eventsErr } = await supabase
    .from("tournament_events")
    .select("*")
    .eq("tournament_id", source.id);
  if (eventsErr) throw new Error(`reading tournament_events: ${eventsErr.message}`);
  if (events && events.length > 0) {
    const rows = events.map(({ id: _id, tournament_id: _tid, ...rest }) => ({
      ...rest,
      tournament_id: newTournamentId,
    }));
    const { error } = await supabase.from("tournament_events").insert(rows);
    if (error) throw new Error(`cloning tournament_events: ${error.message}`);
  }

  // prize_distributions
  const { data: payouts, error: payoutsErr } = await supabase
    .from("prize_distributions")
    .select("*")
    .eq("tournament_id", source.id);
  if (payoutsErr) throw new Error(`reading prize_distributions: ${payoutsErr.message}`);
  if (payouts && payouts.length > 0) {
    const rows = payouts.map(({ id: _id, tournament_id: _tid, ...rest }) => ({
      ...rest,
      tournament_id: newTournamentId,
    }));
    const { error } = await supabase.from("prize_distributions").insert(rows);
    if (error) throw new Error(`cloning prize_distributions: ${error.message}`);
  }

  // color_up_requests
  const { data: colorUps, error: colorUpsErr } = await supabase
    .from("color_up_requests")
    .select("*")
    .eq("tournament_id", source.id);
  if (colorUpsErr) throw new Error(`reading color_up_requests: ${colorUpsErr.message}`);
  if (colorUps && colorUps.length > 0) {
    const rows = colorUps.map(({ id: _id, tournament_id: _tid, ...rest }) => ({
      ...rest,
      tournament_id: newTournamentId,
    }));
    const { error } = await supabase.from("color_up_requests").insert(rows);
    if (error) throw new Error(`cloning color_up_requests: ${error.message}`);
  }

  console.log(`Done. Sandbox tournament ${newTournamentId} is ready — visit /sandboxadmin/history.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
