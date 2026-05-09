-- Holdem Clock — wipe test tournament data
--
-- Travis ran a series of test games while developing the app and now
-- wants holdemclock.com to launch with a clean slate. This migration
-- deletes every row in the per-tournament tables but PRESERVES:
--
--   - players              (the master roster — names + signal handles)
--   - tournament_templates (the recurring league configs)
--   - blind_structures     (the per-template blind level data)
--   - profiles / auth      (admin users)
--
-- After this runs, /history will read empty (zero finished tournaments)
-- and the next tournament the admin starts will be tournament #1 of
-- the real season. The masters above stay so the admin doesn't have
-- to re-enter rosters / templates / blinds from scratch.
--
-- Order matters: child rows go first to avoid FK violations.
--
-- This is a destructive one-shot — running it again is a no-op (DELETEs
-- on already-empty tables) but the data it removes is gone for good.
-- If you're applying this against a database that has REAL tournaments
-- you want to keep, DON'T. Skip the migration or scope it with a WHERE.

BEGIN;

-- prize_distributions → tournaments
DELETE FROM public.prize_distributions;

-- color_up_requests → tournaments + players
DELETE FROM public.color_up_requests;

-- tournament_events → tournaments
DELETE FROM public.tournament_events;

-- tournament_players → tournaments + players
DELETE FROM public.tournament_players;

-- tournaments (parent — last)
DELETE FROM public.tournaments;

COMMIT;
