-- Holdem Clock — table-admin role + admin chip edits
--
-- Two related needs:
--
--   1. The room's head admin (Travis) wants to update a player's
--      `current_chips` directly from /admin — especially right before
--      a table merge, where he wants the displayed leaderboard to
--      reflect physical counts without depending on every player
--      tapping the QR-driven /play self-report. We solve this with a
--      new `chip_adjust` event type so each admin tweak is auditable
--      in the events stream like every other state change.
--
--   2. Each table needs a designated "table admin" (typically the
--      player sitting there) who can mark outs, approve color-ups,
--      and edit chip counts FOR THEIR TABLE only — without giving
--      them the full /admin keys. Instead of a separate role table,
--      we tie the permission to the player's master roster spot:
--      `players.auth_user_id` claims the spot for one auth user.
--      Whichever table that player is seated at in a running
--      tournament becomes their managed table.
--
-- All authorization is enforced in Server Actions (which use the
-- service-role client to write); the RLS on tournament_players /
-- tournament_events / color_up_requests stays admin-only as a
-- defence-in-depth fallback. The only RLS change is a self-read on
-- `players` so a signed-in linked user can fetch their own row
-- without the service-role bypass.

-- ─────────────────────────────────────────────────────────────────
-- 1. players.auth_user_id — claimable roster spot
-- ─────────────────────────────────────────────────────────────────
alter table public.players
  add column if not exists auth_user_id uuid
    references auth.users(id) on delete set null;

-- One auth user → at most one roster spot. Multiple unlinked spots
-- are fine (auth_user_id IS NULL), but a claimed spot is exclusive.
create unique index if not exists players_auth_user_id_idx
  on public.players (auth_user_id)
  where auth_user_id is not null;

comment on column public.players.auth_user_id is
  'Optional link to the Supabase auth user that owns this roster spot. When set, that user is the table admin for whichever table this player is seated at in a running tournament.';

-- ─────────────────────────────────────────────────────────────────
-- 2. tournament_events.type — allow chip_adjust
-- ─────────────────────────────────────────────────────────────────
-- Extends the CHECK to log admin (and table-admin) chip-count
-- edits. Payload shape:
--   {
--     tournament_player_id, player_id,
--     at_level, table_number, seat_number,
--     before, after, delta,
--     actor: 'admin' | 'table_admin',
--     reason?: string
--   }
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
    'chip_adjust'
  ));

comment on constraint tournament_events_type_check on public.tournament_events is
  'Allowed event types. chip_adjust was added in 0010 so admins and table admins can correct a player''s current_chips mid-tournament and leave an audit trail.';

-- ─────────────────────────────────────────────────────────────────
-- 3. players: self-read RLS so a linked user can fetch their row
-- ─────────────────────────────────────────────────────────────────
-- The existing `players_admin_all` policy locks SELECT to global
-- admins. A table admin signing in (non-admin) needs to read their
-- OWN row to discover their player_id (and from there, their
-- current seat). Service-role would also work, but a tightly-scoped
-- RLS policy lets future client-side calls work without bypass.
create policy "players_self_read"
  on public.players for select
  to authenticated
  using (auth_user_id = auth.uid());
