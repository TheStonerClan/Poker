-- Holdem Clock — knockout tracking
--
-- Records who busted whom. `tournament_players.knocked_out_by_player_id`
-- is the live, correctable state (set/changed/cleared by an admin or
-- table admin from the busted player's tile, mirroring how the bounty
-- collector is recorded) — this is what all aggregation reads from
-- (leaderboards, per-player totals, KO:entries ratio).
--
-- The `knockout` event type is the append-only audit trail alongside it,
-- recorded on every set/clear so `undoEvent`'s rebuy-undo path (which
-- re-busts a player from a state that predates any rebuy) can look back
-- and restore whatever attribution was true at that point in time —
-- the live column alone can't do that once a rebuy has nulled it out.
--
-- Deliberately NOT a foreign key to players, unlike every other
-- *_player_id column in this schema. tournament_players already has one
-- FK to players (player_id); adding a second (even briefly, during
-- development of this migration) makes every un-hinted
-- `player:players(...)` / `players(...)` embed query PostgREST does
-- across the app ambiguous ("more than one relationship was found"),
-- which breaks in production the instant the migration lands — before
-- any app code hinting the relationship name is deployed. Existence is
-- validated at the application layer instead (see recordKnockout in
-- app/admin/tournaments/[id]/actions.ts).

-- ─────────────────────────────────────────────────────────────────
-- 1. tournament_players — knockout attribution
-- ─────────────────────────────────────────────────────────────────
alter table public.tournament_players
  add column if not exists knocked_out_by_player_id uuid;

alter table public.tournament_players
  drop constraint if exists tournament_players_knockout_not_self;

alter table public.tournament_players
  add constraint tournament_players_knockout_not_self
  check (knocked_out_by_player_id is null or knocked_out_by_player_id <> player_id);

comment on column public.tournament_players.knocked_out_by_player_id is
  'Who busted this player, if recorded. Null until an admin/table admin records it (or after a bust/rebuy is undone, or a rebuy clears it since the elimination it was attributed to no longer stands). Source of truth for knockout leaderboards and per-player KO totals — the knockout event log is the audit trail, not what aggregation reads. Not a foreign key (see file header) — validated at the application layer.';

-- ─────────────────────────────────────────────────────────────────
-- 2. tournament_events.type — allow knockout
-- ─────────────────────────────────────────────────────────────────
-- Payload shape: { tournament_player_id, player_id (victim),
--                  knocked_out_by_player_id (null on a clear) }
alter table public.tournament_events
  drop constraint if exists tournament_events_type_check;

alter table public.tournament_events
  add constraint tournament_events_type_check
  check (type in (
    'bust',
    'rebuy',
    'addon',
    'color_up',
    'level_advance',
    'level_pause',
    'level_resume',
    'break_start',
    'break_end',
    'finalize',
    'claim',
    'release',
    'prize_payout',
    'admin_note',
    'chip_snapshot',
    'chip_adjust',
    'bounty_collected',
    'undo',
    'knockout'
  ));

comment on constraint tournament_events_type_check on public.tournament_events is
  'Allowed event types. knockout (who busted whom, including clears) was added in 0017.';
