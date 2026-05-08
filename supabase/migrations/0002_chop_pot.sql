-- Holdem Clock — chop-pot support
--
-- Some nights the final two players agree to split the pot evenly rather
-- than play out heads-up. Add `is_chopped` to `prize_distributions` so the
-- finalize flow can mark both top finishers as tied and the recap/UI can
-- render them as "tied for 1st".
--
-- Design choice: keep `position` distinct (1 and 2) so the existing unique
-- index `prize_distributions_tourney_position_idx (tournament_id, position)`
-- remains intact, and use the boolean to label the tie. Less invasive than
-- dropping the unique constraint and dealing with two rows at position=1.

alter table public.prize_distributions
  add column if not exists is_chopped boolean not null default false;

comment on column public.prize_distributions.is_chopped is
  'When true, this row was paid as part of a chop — players at chopped positions split the combined pot equally and are rendered as tied for the lowest involved position.';
