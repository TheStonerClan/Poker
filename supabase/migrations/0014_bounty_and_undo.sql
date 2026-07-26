-- Holdem Clock — returning-player bounty + audit-log undo
--
-- Two related additions:
--
--   1. Bounty: a $20 side-pot against the highest-placed player from the
--      prior finished tournament who's playing again tonight (1st if
--      they're back, else 2nd, else 3rd, ...). Resolved once at
--      tournament creation and persisted on the row so it stays stable
--      even as the roster/table assignments change through the night.
--      `bounty_amount` comes out of the effective prize pool before
--      payouts are computed. `bounty_collected_by_player_id` records who
--      busted the target, once an admin marks it.
--
--   2. Undo: admin-only compensating action for bust/rebuy/addon/
--      chip_adjust mistakes (e.g. marking the wrong player out).
--      `tournament_events` is append-only (no UPDATE/DELETE), so undo is
--      implemented as a new `undo` event referencing the original by id,
--      not a mutation of history.

-- ─────────────────────────────────────────────────────────────────
-- 1. tournaments — bounty columns
-- ─────────────────────────────────────────────────────────────────
alter table public.tournaments
  add column if not exists bounty_target_player_id uuid
    references public.players(id) on delete set null;

alter table public.tournaments
  add column if not exists bounty_amount numeric not null default 20;

alter table public.tournaments
  add column if not exists bounty_collected_by_player_id uuid
    references public.players(id) on delete set null;

comment on column public.tournaments.bounty_target_player_id is
  'Resolved once at tournament creation: the highest-placed player from the prior finished tournament (same is_sandbox) who is also in tonight''s roster. Null if there was no prior tournament or none of its finishers returned.';
comment on column public.tournaments.bounty_amount is
  'Dollar amount subtracted from the effective prize pool when bounty_target_player_id is set. Defaults to $20 per the house rule.';
comment on column public.tournaments.bounty_collected_by_player_id is
  'Set when an admin records who busted the bounty target. Null until collected (or if there is no target).';

-- ─────────────────────────────────────────────────────────────────
-- 2. tournament_events.type — allow bounty_collected + undo
-- ─────────────────────────────────────────────────────────────────
-- Payload shapes:
--   bounty_collected: { target_player_id, collected_by_player_id, amount }
--   undo: { undone_event_id, undone_type, tournament_player_id, ...restored fields }
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
    'undo'
  ));

comment on constraint tournament_events_type_check on public.tournament_events is
  'Allowed event types. bounty_collected (who busted the bounty target) and undo (compensating reversal of a bust/rebuy/addon/chip_adjust) were added in 0014.';
