-- Holdem Clock — per-table configuration
--
-- Extends 0005's flat (num_tables, max_seats_per_table) model with a per-
-- table config JSONB so each table can have its own name, color, and seat
-- cap. The wizard now lets the admin name "Felt", "Main", "Overflow"
-- (etc.) and pick a different color per table; the randomize action
-- honors per-table capacities so smaller tables fill first and any
-- stragglers naturally land at the larger ones.
--
-- Shape:
--   tables_config: jsonb array, length == num_tables. Each entry:
--     { name: string, color: string, max_seats: integer }
--
-- The legacy `num_tables` and `max_seats_per_table` columns stay for
-- backward compatibility — readers prefer `tables_config` when present
-- and fall back to N tables of `max_seats_per_table` otherwise.

alter table public.tournaments
  add column if not exists tables_config jsonb;

comment on column public.tournaments.tables_config is
  'Per-table config: array of { name, color, max_seats }. Length matches num_tables. NULL falls back to defaults driven by num_tables + max_seats_per_table.';
