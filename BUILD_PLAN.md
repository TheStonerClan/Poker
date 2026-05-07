# Poker Tournament App — Build Plan

_Last updated: 2026-05-07_

## Decisions locked in

| Area | Choice |
|---|---|
| Frontend | Next.js (App Router) + Tailwind |
| Backend / DB | Supabase (Postgres + Auth + Realtime + Storage) |
| Hosting | Vercel (free tier) |
| Player ID | No accounts; session-bound claim via Supabase Realtime presence; tab-close releases claim |
| Admin | Supabase Auth (email magic link), used primarily on phone |
| TV display | Read-only browser page; matches reference screenshot aesthetic |
| Signal | signal-cli on Mac Mini, personal phone number, `[PokerBot]` prefix |
| Repo | `TheStonerClan/Poker` (public) — separate from MLL account |
| Domain | `holdemclock.com` — DNS managed by Cloudflare, pointed at Vercel |

## Three-surface UX

```
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│  /tv (read-only)   │   │  /admin (auth)     │   │  /play/[sessionId] │
│  TV display        │   │  Admin phone       │   │  Player phone (QR) │
│                    │   │                    │   │                    │
│  Clock, blinds,    │   │  Mark in/out,      │   │  Claim name,       │
│  prize pool, who's │   │  rebuys, advance   │   │  request color-up, │
│  out, color-up     │   │  level, finalize   │   │  view stats        │
└────────┬───────────┘   └────────┬───────────┘   └────────┬───────────┘
         └────────── Supabase Realtime ──────────┘
```

## Database schema sketch

```
players                 -- master roster (the inactive queue)
  id, name, signal_handle, created_at

tournament_templates    -- recurring config (e.g., "3rd Friday Monthly")
  id, name, recurrence_rule, buy_in, starting_stack, max_rebuys,
  rebuy_price, rebuy_chips, side_pots[], rounding_mode, prize_rules,
  blind_structure_id, created_at

blind_structures        -- versioned reusable structures
  id, name, levels[] {level_num, small, big, ante, duration_sec, is_break, color_up_chips[]}

tournaments             -- one instance / one poker night
  id, template_id, scheduled_at, started_at, finished_at, status,
  buy_in_snapshot, starting_stack_snapshot, ...all settings copied at launch
  (immutable once finished_at is set)

tournament_players      -- who's playing tonight + their state
  id, tournament_id, player_id, seat_number, claimed_session_id,
  current_chips, buyback_used (bool), buyback_used_as ('rebuy'|'addon'|null),
  buyback_used_at_level, buyback_used_at_time,
  busted_at_level, busted_at_time,
  finishing_position, payout_amount

tournament_events       -- append-only log for history & analytics
  id, tournament_id, type, payload, created_at
  (types: bust, rebuy, color_up, level_advance, break_start, break_end, finalize)

color_up_requests       -- player-submitted exchange requests
  id, tournament_id, player_id, submitted_chips, exchange_for_chips,
  status, created_at, processed_at

prize_distributions     -- snapshot of payouts per tournament
  id, tournament_id, position, amount, player_id, paid_at
```

## Build phases (proposed execution order)

Travis wants the whole thing before launch, so these are sequential not optional. Order is chosen to surface integration risks early.

### Phase 0 — Foundations (1 sitting)
- Next.js + Tailwind project init
- Supabase project, schema migration, RLS policies
- Auth setup (email magic link for admin)
- Vercel deploy + env vars
- README placeholders for personal GitHub repo

### Phase 1 — Tournament timer + TV display (2-3 sittings)
- Blind structure editor
- Tournament configuration screen
- Read-only TV display matching screenshot aesthetic
- Real-time clock sync across devices via Supabase Realtime
- Level advancement, breaks, ante on/off

### Phase 2 — Admin controls (2-3 sittings)
- Mobile-first admin dashboard
- Player roster management (master list + tonight's session)
- Mark in/out, rebuy with limit enforcement
- Side-pot tracking (4-of-a-kind, straight flush)
- Edit-while-running for tournament settings

### Phase 3 — Player lightweight view (1-2 sittings)
- QR code generator on TV display
- `/play/[sessionId]` with un-claimed name list
- Supabase presence claim + tab-close release
- Color-up request flow with smart denomination math
- Player-facing stats view

### Phase 4 — Prize math + finalization (1-2 sittings)
- Prize distribution engine (static positions + percentages of remainder)
- Rounding modes ($1 / $5 / $10 / $20, surplus to 1st)
- Tournament finalize → results lock → push to history
- Reset to inactive queue

### Phase 5 — Recurring tournaments + analytics (2 sittings)
- Recurrence rule builder ("3rd Friday every month" UI)
- Auto-create next tournament on finalize
- Historical analytics dashboard
- Player-level stats (win rate, avg finish, bust round histogram, rebuy rate)
- Season leaderboards

### Phase 6 — Signal integration (1-2 sittings)
- signal-cli setup script for the Mac Mini
- Webhook relay (Tailscale or ngrok-tunneled local HTTP server)
- Reminder template (X days before next tournament)
- Recap template (sent on finalize): final standings, payouts, notable moments
- Always prefix `[PokerBot]`

### Phase 7 — Polish (ongoing)
- Mobile responsiveness pass on all surfaces
- TV display tweaks based on real game feel
- Error handling, edge cases, network blips
- Loading states, optimistic UI

## What I'm waiting on from Travis

1. ~~GitHub username + repo name + visibility~~ — `TheStonerClan/Poker`, public ✓
2. ~~Current ultimate-holdem-timer config~~ — parsed from backup, seeded as "Bluff and Baffoons" ✓
3. ~~Domain~~ — `holdemclock.com` (Cloudflare DNS → Vercel) ✓
4. **Player roster** — names of regulars to seed `players` table (can wait until Phase 2)
5. **Signal group identifier** — Signal group ID/name for the bot to post to (can wait until Phase 6)
6. **Email for Git commits** — what email should be associated with commits to TheStonerClan/Poker so they don't attribute to MLL?

## House rules (locked in)

- **Buyback rule:** Each player has exactly ONE buyback token per tournament. The token is redeemable in two ways: (a) when busted on or before Level 6, swap it for a fresh 500-chip starting stack for $20; (b) at the L8 break (2nd color-up), spend it to add 500 chips on top of current stack for $20. Once redeemed in either mode, the token is gone. The admin UI must surface a player's token status (unused / used as rebuy / used as add-on) and the player view must show "Buyback available — use at next break" when applicable. Buyback proceeds add to the prize pool exactly like buy-ins.

## Open questions to revisit per phase

- How are side-pot wins tracked? Manual admin entry mid-hand? Just a running tally we award at finalize?
- Color-up auto-suggestion math: when player has $23 and we're removing 1s/5s with 10s/25s/100s remaining, do we round UP to $25 (player owes nothing extra) or DOWN to $20 (player gets $3 in smaller denoms back)?
- Recurring schedule: what happens if 3rd Friday is a holiday? Manual skip or auto-shift?
- Multi-admin: just Travis, or can other regulars get admin rights?
