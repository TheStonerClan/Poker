-- Holdem Clock — table-admin seat confirmation
--
-- Physical seat positions at each table can drift from what the system
-- thinks: a system-assigned seat puts Alice in seat 3, but at the
-- actual table she's sitting in seat 5 because that's where she put
-- her drink. The hand tracker reads seat numbers to figure out blinds
-- and dealer position, so drift breaks things.
--
-- Three triggers prompt the table admin to (re)confirm seating:
--   1. First time the table admin signs in for a tournament — the
--      initial system-assigned seats are unconfirmed.
--   2. After a table balance or merge — the system reseats half the
--      table; the new layout needs human acknowledgment.
--   3. After the head admin manually moves a player to this table —
--      same reason.
--
-- We track this with a single nullable timestamp per
-- `tournament_players` row. The row is "needs confirmation" when
-- `seat_confirmed_at IS NULL`. The table page shows a banner whenever
-- any active player at the table has a null confirmation, and the
-- "Confirm seating" editor stamps `now()` on every player at the
-- table after the admin commits the layout.

alter table public.tournament_players
  add column if not exists seat_confirmed_at timestamptz;

-- Single-column index so the banner / hand-start gate can query
-- "any unconfirmed seats at (tournament, table)?" cheaply. Partial
-- to keep it tiny — the steady state is "everyone confirmed", and
-- a NULL partial index only stores the seat changes that matter.
create index if not exists tournament_players_seat_unconfirmed_idx
  on public.tournament_players (tournament_id, table_number)
  where seat_confirmed_at is null;

comment on column public.tournament_players.seat_confirmed_at is
  'When the table admin last confirmed this player''s physical seat. Null on initial roster, balance, merge, manual move, or admin add. The /table page nags until confirmed.';
