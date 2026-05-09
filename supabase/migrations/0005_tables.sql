-- Holdem Clock — table management
--
-- Multi-table tournaments. Admin configures the number of tables and the
-- max seats per table during the new-tournament wizard; players are then
-- randomized to (table, seat) on tournament creation. The TV shows a
-- pre-game view of the assignments while the tournament is in
-- `scheduled` state, then auto-flips to the live timer once it goes
-- `running`.
--
-- Schema changes:
--   1. tournaments: num_tables, max_seats_per_table.
--   2. tournament_players: table_number.
--   3. The existing (tournament_id, seat_number) unique index is too
--      restrictive — seat 5 at table 1 and seat 5 at table 2 should
--      both be allowed. Replace it with a (tournament_id, table_number,
--      seat_number) unique index that scopes seat numbers per-table.
--
-- All new columns are nullable so existing tournaments stay valid; the
-- new unique index only applies when both table_number and seat_number
-- are non-null, matching the legacy index's WHERE clause.

alter table public.tournaments
  add column if not exists num_tables integer
    check (num_tables is null or num_tables > 0),
  add column if not exists max_seats_per_table integer
    check (max_seats_per_table is null or max_seats_per_table > 0);

alter table public.tournament_players
  add column if not exists table_number integer
    check (table_number is null or table_number > 0);

-- Replace the legacy (tournament_id, seat_number) index with one that
-- includes the table number. We drop the old index by name; if it's
-- missing (already renamed in a previous run) the IF EXISTS makes this
-- a no-op.
drop index if exists public.tournament_players_tourney_seat_idx;

create unique index if not exists tournament_players_tourney_table_seat_idx
  on public.tournament_players (tournament_id, table_number, seat_number)
  where table_number is not null and seat_number is not null;

-- Sanity index for "all players at table N this tournament" queries
-- (TV pre-game view groups by this).
create index if not exists tournament_players_tourney_table_idx
  on public.tournament_players (tournament_id, table_number)
  where table_number is not null;

comment on column public.tournaments.num_tables is
  'Number of tables in this tournament. Set in the wizard; null for tournaments that pre-date table management.';
comment on column public.tournaments.max_seats_per_table is
  'Max seats per table; (num_tables * max_seats_per_table) is the hard cap on roster size.';
comment on column public.tournament_players.table_number is
  'Which table this player sits at (1..num_tables). Paired with seat_number to identify a unique chair.';
