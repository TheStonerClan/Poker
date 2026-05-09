-- Holdem Clock — chip-count snapshots at breaks
--
-- Adds a new tournament_events `type` value so players can log their post-
-- color-up chip count from /play. Each row is appended-only and indexed by
-- (tournament_id, created_at) like every other event, so analytics can
-- compute break-over-break gains/losses by joining player_id + level_num
-- across submissions.
--
-- We extend the CHECK constraint rather than introducing a new table so
-- the events stream stays the single source of truth for "what happened
-- and when" during the night. The existing append-only triggers + RLS
-- already give us the right protection.

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
    'chip_snapshot'
  ));

comment on constraint tournament_events_type_check on public.tournament_events is
  'Allowed event types. chip_snapshot was added in 0004 so players can self-report their post-color-up totals at breaks for analytics.';
