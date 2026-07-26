-- Holdem Clock — sandbox tournaments
--
-- Travis needs a permanent place to test new features (/sandboxtv,
-- /sandboxadmin, ...) without ever mixing test data into the real
-- leaderboard/history or triggering a real Signal recap. Rather than a
-- second Supabase project, sandbox tournaments live in the same tables
-- as real ones, distinguished by this flag. Every query that scans
-- across tournaments (active-tournament lookups, /history, the
-- /admin tournaments list, the Signal recap dispatch) filters on it;
-- child tables (tournament_players, tournament_events,
-- color_up_requests, prize_distributions) don't need their own copy
-- of the flag since they scope through tournament_id already.

alter table public.tournaments
  add column is_sandbox boolean not null default false;

create index tournaments_sandbox_status_idx
  on public.tournaments (is_sandbox, status);

comment on column public.tournaments.is_sandbox is
  'True for tournaments created from /sandboxadmin. Excluded from /history, the real /admin tournaments list, active-tournament lookups on /tv and /admin, and Signal recap dispatch.';
