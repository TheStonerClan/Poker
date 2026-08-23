-- Holdem Clock — seed data
--
-- Loads Travis's "Bluff and Baffoons" tournament_template (and its blind
-- structure) so a fresh dev DB has something to render. Mirrors
-- seed/bluff-and-baffoons.json. Idempotent — safe to re-run; it skips rows
-- whose name already exists.

-- ─────────────────────────────────────────────────────────────────────────────
-- Blind structure: "Bluff and Baffoons (default)"
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.blind_structures (name, levels, notes)
select
  'Bluff and Baffoons (default)',
  jsonb_build_array(
    jsonb_build_object('level_num', 1,  'small',   1, 'big',   2, 'ante',   2, 'duration_sec',  900, 'is_break', false),
    jsonb_build_object('level_num', 2,  'small',   2, 'big',   4, 'ante',   4, 'duration_sec',  900, 'is_break', false),
    jsonb_build_object('level_num', 3,  'small',   4, 'big',   8, 'ante',   8, 'duration_sec',  900, 'is_break', false),
    jsonb_build_object('level_num', 4,  'small',   8, 'big',  16, 'ante',  16, 'duration_sec',  900, 'is_break', false),
    jsonb_build_object('level_num', 5,                                            'duration_sec',  600, 'is_break', true,  'color_up_chips', jsonb_build_array(1, 5)),
    jsonb_build_object('level_num', 6,  'small',  20, 'big',  40, 'ante',  40, 'duration_sec', 1200, 'is_break', false),
    jsonb_build_object('level_num', 7,  'small',  40, 'big',  80, 'ante',  80, 'duration_sec', 1200, 'is_break', false),
    jsonb_build_object('level_num', 8,                                            'duration_sec',  600, 'is_break', true,  'color_up_chips', jsonb_build_array(10, 25)),
    jsonb_build_object('level_num', 9,  'small', 100, 'big', 200, 'ante', 200, 'duration_sec', 1200, 'is_break', false),
    jsonb_build_object('level_num', 10, 'small', 200, 'big', 400, 'ante', 400, 'duration_sec', 1200, 'is_break', false),
    jsonb_build_object('level_num', 11, 'small', 400, 'big', 800, 'ante', 800, 'duration_sec', 7200, 'is_break', false)
  ),
  'Seeded from seed/bluff-and-baffoons.json on initial setup.'
where not exists (
  select 1 from public.blind_structures
  where lower(name) = lower('Bluff and Baffoons (default)')
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tournament template: "Bluff and Baffoons"
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.tournament_templates (
  name,
  location,
  currency,
  recurrence_rule,
  buy_in,
  starting_stack,
  max_rebuys,
  rebuy_price,
  rebuy_chips,
  ante_mode,
  buyback_config,
  side_pots,
  rounding_mode,
  prize_rules,
  chip_denominations,
  starting_stack_composition,
  blind_structure_id
)
select
  'Bluff and Baffoons',
  'Jarrell',
  'USD',
  null,                                       -- recurrence_rule TBD; manual scheduling for now
  20,
  500,
  1,                                          -- max_rebuys: legacy/unenforced column; buyback_config below is authoritative
  20,
  500,
  'BB',
  jsonb_build_object(
    'rebuysPerPlayer', 1,
    'addOnsPerPlayer', 1,
    'price', 20,
    'rebuyChips', 500,
    'rebuyAllowedThroughLevel', 6,
    'addOnAtBreakLevel', 8,
    'addOnChips', 500
  ),
  jsonb_build_object(
    'fourOfAKind',  jsonb_build_object('enabled', false, 'amount', 0),
    'straightFlush', jsonb_build_object('enabled', false, 'amount', 0)
  ),
  jsonb_build_object('increment', 10, 'surplusToFirst', true),
  jsonb_build_object(
    'type', 'static',
    'guarantee', 0,
    'overlay', true,
    'rounding', jsonb_build_object('increment', 10, 'surplusToFirst', true),
    'rules', jsonb_build_array(
      jsonb_build_object('position', 1, 'kind', 'percentRemainder', 'value', 70),
      jsonb_build_object('position', 2, 'kind', 'percentRemainder', 'value', 30),
      jsonb_build_object('position', 3, 'kind', 'fixed',            'value', 20)
    )
  ),
  jsonb_build_array(
    jsonb_build_object('color', 'white', 'value',   1),
    jsonb_build_object('color', 'red',   'value',   5),
    jsonb_build_object('color', 'blue',  'value',  10),
    jsonb_build_object('color', 'green', 'value',  25),
    jsonb_build_object('color', 'black', 'value', 100)
  ),
  jsonb_build_array(
    jsonb_build_object('color', 'white', 'count', 20),
    jsonb_build_object('color', 'red',   'count', 16),
    jsonb_build_object('color', 'blue',  'count', 10),
    jsonb_build_object('color', 'green', 'count',  4),
    jsonb_build_object('color', 'black', 'count',  2)
  ),
  bs.id
from public.blind_structures bs
where lower(bs.name) = lower('Bluff and Baffoons (default)')
  and not exists (
    select 1 from public.tournament_templates
    where lower(name) = lower('Bluff and Baffoons')
  );
