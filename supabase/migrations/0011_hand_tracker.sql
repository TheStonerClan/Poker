-- Holdem Clock — live hand tracker
--
-- Adds per-hand state for table admins (or the global admin) to log
-- every action (fold / check / call / bet / raise / all-in) at their
-- table in real time. Blinds + antes are auto-posted at hand start;
-- each action debits the player's `hand_seats.current_chips`; the
-- final pot (with full side-pot computation) is awarded to the
-- winner(s) at hand close and pushed back into the tournament-wide
-- `tournament_players.current_chips`.
--
-- Data model:
--   - hands           — one row per (tournament, table, hand_number).
--                       Snapshots the level's blinds + ante so a
--                       structure change doesn't retroactively rewrite
--                       past hands.
--   - hand_seats      — who was at which seat when the hand started,
--                       their chip stack going in, and rolling state
--                       (current_chips, total_contributed, folded,
--                       all-in). Updated as actions land.
--   - hand_actions    — append-only action log. The pot, current-bet,
--                       to-act-next, and per-seat contribution are all
--                       derived from this log + hand_seats.
--   - hand_results    — pot distribution at showdown. Multiple rows
--                       per hand if side pots exist or the pot is
--                       split between tied winners.
--
-- Everything is "public read" so the TV and history pages can render
-- a live hand panel without authentication. Writes are admin-only via
-- RLS; table-admin actions use the service-role client + JS-level
-- gates (same pattern as Phase 1's bust/color-up/chip-adjust flow).

-- ─────────────────────────────────────────────────────────────────
-- hands
-- ─────────────────────────────────────────────────────────────────
create table public.hands (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.tournaments(id) on delete cascade,
  table_number        integer not null check (table_number > 0),
  -- Sequential per (tournament, table). Reserved at start time so
  -- concurrent "start hand" attempts can't clash even if the UI
  -- double-fires; the unique index below enforces uniqueness.
  hand_number         integer not null check (hand_number > 0),

  -- Level + blind snapshot. Stored on the hand row so a level change
  -- (admin advanced the timer) doesn't retroactively change blinds
  -- on hands logged at the previous level.
  level_num           integer not null check (level_num >= 0),
  small_blind         integer not null check (small_blind >= 0),
  big_blind           integer not null check (big_blind > 0),
  ante                integer not null default 0 check (ante >= 0),

  -- Seat positions for this hand (refers to tournament_players.seat_number).
  -- Heads-up rules (dealer = SB) handled in JS — schema just stores
  -- whichever seats the action helper computed.
  dealer_seat         integer not null check (dealer_seat > 0),
  sb_seat             integer not null check (sb_seat > 0),
  bb_seat             integer not null check (bb_seat > 0),

  -- 'active' until the hand is awarded; 'complete' once a winner is
  -- recorded; 'cancelled' if the admin scraps a misclick start. A
  -- table can only have one active hand at a time (enforced by the
  -- unique partial index below).
  status              text not null default 'active'
                        check (status in ('active','complete','cancelled')),

  -- Current betting street. Advanced by the postAction helper when
  -- everyone matches; 'showdown' is the transition state during
  -- pot-award UI; 'complete' is the terminal value.
  current_street      text not null default 'preflop'
                        check (current_street in (
                          'preflop','flop','turn','river','showdown','complete'
                        )),

  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  notes               text
);

create unique index hands_tournament_table_number_idx
  on public.hands (tournament_id, table_number, hand_number);

-- Only one active hand per (tournament, table) at any moment. The
-- "Start hand" action checks this in JS too, but the partial index
-- makes a race impossible at the DB level.
create unique index hands_one_active_per_table_idx
  on public.hands (tournament_id, table_number)
  where status = 'active';

create index hands_tournament_status_idx
  on public.hands (tournament_id, status);

-- ─────────────────────────────────────────────────────────────────
-- hand_seats
-- ─────────────────────────────────────────────────────────────────
create table public.hand_seats (
  hand_id              uuid not null references public.hands(id) on delete cascade,
  seat_number          integer not null check (seat_number > 0),
  tournament_player_id uuid not null references public.tournament_players(id) on delete cascade,

  -- Stack going INTO the hand (locked at start, never mutated). Used
  -- by side-pot math + the "stack delta" history view.
  starting_chips       integer not null check (starting_chips >= 0),

  -- Rolling state, updated by postAction / undoLastAction.
  current_chips        integer not null check (current_chips >= 0),
  total_contributed    integer not null default 0 check (total_contributed >= 0),
  is_folded            boolean not null default false,
  is_all_in            boolean not null default false,

  primary key (hand_id, seat_number)
);

create index hand_seats_player_idx on public.hand_seats (tournament_player_id);
create unique index hand_seats_hand_player_idx
  on public.hand_seats (hand_id, tournament_player_id);

-- ─────────────────────────────────────────────────────────────────
-- hand_actions  (append-only-ish — undo deletes the most recent row)
-- ─────────────────────────────────────────────────────────────────
create table public.hand_actions (
  id                   uuid primary key default gen_random_uuid(),
  hand_id              uuid not null references public.hands(id) on delete cascade,
  street               text not null
                         check (street in ('preflop','flop','turn','river')),
  -- Monotonic per (hand, street). The first action on each street
  -- is sequence=1; ties on the same street are impossible because
  -- actions are taken one at a time.
  sequence             integer not null check (sequence > 0),

  seat_number          integer not null check (seat_number > 0),
  tournament_player_id uuid not null references public.tournament_players(id) on delete cascade,

  -- Includes blind/ante posts so the log captures the full story
  -- (current_bet and pot are derived from this log). 'all_in' is
  -- a separate marker from call/bet/raise because the contribution
  -- amount may not match the current bet.
  action               text not null
                         check (action in (
                           'post_sb','post_bb','post_ante',
                           'check','call','bet','raise','fold','all_in'
                         )),

  -- Chips contributed BY THIS ACTION (always >= 0). For checks and
  -- folds, amount = 0. For all-in, amount = the player's remaining
  -- stack at the time.
  amount               integer not null default 0 check (amount >= 0),
  chips_remaining      integer not null check (chips_remaining >= 0),

  created_at           timestamptz not null default now()
);

create unique index hand_actions_hand_street_sequence_idx
  on public.hand_actions (hand_id, street, sequence);
create index hand_actions_hand_idx on public.hand_actions (hand_id, created_at);

-- ─────────────────────────────────────────────────────────────────
-- hand_results  (final pot distribution)
-- ─────────────────────────────────────────────────────────────────
-- One row per (pot, winner). A heads-up showdown with no side pots
-- writes one row. A 3-way all-in with two side pots writes 3+ rows
-- (one per pot, one extra per pot per tied winner).
create table public.hand_results (
  id                   uuid primary key default gen_random_uuid(),
  hand_id              uuid not null references public.hands(id) on delete cascade,
  tournament_player_id uuid not null references public.tournament_players(id) on delete cascade,

  -- 'main', 'side_1', 'side_2', ... 'uncontested' (last-folder-walks
  -- pot — everyone folded except one player, no showdown).
  pot_kind             text not null,
  amount_won           integer not null check (amount_won >= 0),
  is_split             boolean not null default false,

  created_at           timestamptz not null default now()
);

create index hand_results_hand_idx on public.hand_results (hand_id);
create index hand_results_player_idx
  on public.hand_results (tournament_player_id);

-- ─────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────
alter table public.hands         enable row level security;
alter table public.hand_seats    enable row level security;
alter table public.hand_actions  enable row level security;
alter table public.hand_results  enable row level security;

-- Public read so TV / history can render the live hand panel. Matches
-- the precedent set by tournament_players / tournament_events.
create policy "hands_public_read" on public.hands
  for select to anon, authenticated using (true);
create policy "hand_seats_public_read" on public.hand_seats
  for select to anon, authenticated using (true);
create policy "hand_actions_public_read" on public.hand_actions
  for select to anon, authenticated using (true);
create policy "hand_results_public_read" on public.hand_results
  for select to anon, authenticated using (true);

-- Writes admin-only at the RLS layer; table-admin Server Actions use
-- the service-role client after passing requireManagePlayerSlot.
create policy "hands_admin_all" on public.hands for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "hand_seats_admin_all" on public.hand_seats for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "hand_actions_admin_all" on public.hand_actions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "hand_results_admin_all" on public.hand_results for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

comment on table public.hands is
  'One row per hand played at (tournament, table). Snapshots blinds + ante so a level change does not rewrite history.';
comment on table public.hand_seats is
  'Per-seat per-hand state. starting_chips is locked at hand start; current_chips / total_contributed / flags roll as actions land.';
comment on table public.hand_actions is
  'Append-only-ish action log. Undo deletes the most recent row; the rest of the state is derived from this log + hand_seats.';
comment on table public.hand_results is
  'Pot distribution at showdown. One row per (pot, winner). Multiple side pots → multiple rows.';
