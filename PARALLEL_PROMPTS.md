# Parallel Claude Code Prompts

Run these in separate Claude Code instances on **separate git branches** to parallelize the build. Each prompt is self-contained — you can copy-paste it into a fresh CC session.

## House rule every track must respect: BUYBACK TOKEN

Each player has ONE buyback token per tournament. Spendable in either of two ways (after which the token is gone):

1. **As a rebuy** — when busted on or before Level 6, swap the token + $20 for a fresh 500-chip starting stack.
2. **As an add-on at L8 break** — spend the token + $20 to add 500 chips on top of current stack.

Schema reflects this on `tournament_players`: `buyback_used` (bool), `buyback_used_as` (enum: 'rebuy' | 'addon' | null), `buyback_used_at_level`, `buyback_used_at_time`. Buyback proceeds add to the prize pool the same way buy-ins do. The seed config in `/seed/bluff-and-baffoons.json` defines this under the `buyback` key.

Per-track impacts:
- **Track A (TV display):** chip totals + avg stack must include any L8 add-on chips. During L8 break, show "L8 add-on available — see admin" prominently.
- **Track B (Admin shell):** rebuy action must check token availability; L8 break view shows a roster of unused-token players with "Apply add-on" buttons. Token state is part of the admin's player grid.
- **Track C (Player view):** bust flow must let the player know they've spent their token if they choose to rebuy. At L8 break, players with unused tokens see "Use buyback now? +500 chips for $20" prompt that pings admin.
- **Track D (Prize math):** the `Pool` type's `rebuys` field becomes `buybacks` (unified count of both redemption modes since both contribute identically to the pool).

## Dependency map

```
                          ┌────────────────────┐
                          │  PHASE 0           │  ← run FIRST, alone
                          │  Foundation        │
                          │  (Travis or 1 CC)  │
                          └─────────┬──────────┘
                                    │
        ┌───────────────┬───────────┼───────────┬───────────────┐
        ▼               ▼           ▼           ▼               ▼
   ┌─────────┐    ┌─────────┐  ┌─────────┐  ┌─────────┐   ┌─────────┐
   │ Track A │    │ Track B │  │ Track C │  │INTEGRATE│   │ Track H │
   │   TV    │    │  Admin  │  │ Player  │  │  D/E/F  │   │ Signal  │
   │ display │    │  shell  │  │  view   │  │  /G     │   │  -cli   │
   └─────────┘    └─────────┘  └─────────┘  └─────────┘   └─────────┘
                                                               ▲
   ┌────────────────────────────────────────────────────┐      │
   │  CAN RUN IN PARALLEL WITH PHASE 0 (pure libs):     │      │
   │  Track D — Prize math    Track F — Recurrence      │      │
   │  Track E — Color-up      Track G — UHT importer    │      │
   │  Track H — signal-cli setup (separate concern)  ───┼──────┘
   └────────────────────────────────────────────────────┘
```

**Hard rule:** Phase 0 must complete and merge to `main` before Tracks A/B/C start. Tracks D/E/F/G/H have no infra dependency and can be developed before Phase 0 finishes — they just need to be merged onto `main` after Phase 0.

---

## PHASE 0 — Foundation (run first, alone)

**Branch:** `phase-0-foundation`
**Prerequisites:** Travis has created an empty public repo at `https://github.com/TheStonerClan/Poker`. Travis has created a free Supabase project and has the URL + anon key ready. Travis is logged into Vercel via CLI or web. Domain `holdemclock.com` is registered with DNS managed at Cloudflare.

**Prompt:**

```
You are setting up the foundation for a poker tournament timer web app. Read these context files first before doing anything:
- /Users/travisstoner/Documents/Claude/Projects/Poker/BUILD_PLAN.md
- /Users/travisstoner/Documents/Claude/Projects/Poker/seed/bluff-and-baffoons.json

Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker
GitHub repo: https://github.com/TheStonerClan/Poker (public, already created empty)
Stack: Next.js 14+ (App Router) + TypeScript + Tailwind + Supabase + Vercel.

Tasks:
1. Initialize Next.js with App Router, TypeScript, Tailwind, ESLint. Use `pnpm`.
2. Add Supabase client packages (@supabase/supabase-js, @supabase/ssr).
3. Create directory structure:
   /app, /lib, /components, /supabase/migrations, /scripts, /seed (already exists)
4. Set up the design token system in app/globals.css and tailwind.config.ts:
   - Background: #000
   - Gold accent (clock ring): #d4af37 with bright variant #ffd700
   - Category labels: #4ea7e8 (light blue)
   - Values text: #fff
   - All as CSS variables so they can be swapped later.
5. Write the Supabase schema migration in supabase/migrations/0001_initial_schema.sql. Include these tables (full DDL with foreign keys, indexes, and RLS):
   - players (master roster)
   - tournament_templates (recurring config)
   - blind_structures (versioned)
   - tournaments (instance per night)
   - tournament_players (state per player per tournament, includes claimed_session_id)
   - tournament_events (append-only log)
   - color_up_requests
   - prize_distributions
   See BUILD_PLAN.md for the field sketches; flesh them out with proper types and constraints.
6. RLS policies:
   - players, tournament_templates, blind_structures: admin read/write only
   - tournaments, tournament_players: admin write, public read
   - tournament_events: admin insert, public read (server-side functions for special inserts)
   - color_up_requests: anon insert (with valid session), admin update
7. Create supabase/seed.sql that loads bluff-and-baffoons.json as the default tournament_template.
8. Configure Supabase auth — magic link only. Set admin via a custom 'admins' table with email column; create RLS helper function is_admin().
9. Generate TS types from the schema into lib/database.types.ts (use `supabase gen types typescript`).
10. Create lib/supabase/server.ts and lib/supabase/client.ts with proper SSR cookie handling.
11. Build the basic root layout (app/layout.tsx) with Tailwind base styles, dark background, font setup. Use Inter or similar via next/font.
12. Create stub pages so routes resolve: app/page.tsx (redirects to /tv), app/tv/page.tsx, app/admin/page.tsx, app/play/[sessionId]/page.tsx — each just shows "TODO: <route name>" for now.
13. .env.example with NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (server-only).
14. .gitignore — Next.js standard plus .env.local, /node_modules, /.next, *.log, .vercel.
15. README.md — project name "Holdem Clock" (production domain holdemclock.com), tagline "Tournament timer + management for home games", quickstart, env setup, deploy instructions, schema diagram link. Note that the seed default tournament is "Bluff and Baffoons".
16. Configure git: `git config user.name` and `user.email` to Travis's TheStonerClan account (ask him in chat if you need the email — do NOT guess). Do not push yet — confirm with Travis first that it's safe to push.
17. Vercel deploy + custom domain setup:
    - Connect Vercel project to TheStonerClan/Poker repo.
    - Add `holdemclock.com` and `www.holdemclock.com` as custom domains in Vercel project settings.
    - In Cloudflare DNS, add the records Vercel provides — typically:
      * `holdemclock.com` → A record `76.76.21.21` (Vercel's IP) **with proxy DISABLED (gray cloud)**.
      * `www.holdemclock.com` → CNAME `cname.vercel-dns.com` **with proxy DISABLED (gray cloud)**.
    - Critical: Cloudflare proxy must be OFF (gray cloud) for both records — Vercel handles its own CDN/SSL, and the orange-cloud proxy causes redirect loops, SSL handshake failures, and breaks Vercel's automatic Let's Encrypt cert renewal.
    - Set Cloudflare SSL/TLS mode to "Full (strict)" at the zone level.
    - Wait for Vercel to issue the cert (typically <2 min after DNS propagates).
    - In README, document this DNS config so future contributors don't flip it on.
18. After every significant step, run `pnpm build` to confirm nothing's broken.

Deliverables: a building Next.js app with all routes resolving, schema migration ready to apply, and a clear handoff message for Travis listing what HE needs to do (apply migration via Supabase CLI, set env vars in Vercel, etc.).

Do NOT touch any code outside the directories listed above. Do NOT implement any feature logic — that's for parallel tracks.
```

---

## TRACK A — TV Display (depends on Phase 0)

**Branch:** `feat/tv-display`
**File scope:** `/app/tv/`, `/components/tv/`, `/lib/timer/`

**Prompt:**

```
You are building the read-only TV display for a poker tournament app. Read these first:
- /Users/travisstoner/Documents/Claude/Projects/Poker/BUILD_PLAN.md
- /Users/travisstoner/Documents/Claude/Projects/Poker/seed/bluff-and-baffoons.json

Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker

The TV display is the centerpiece — it goes on the big screen during poker night. Match the visual reference (look up the BUILD_PLAN for the screenshot description).

Layout (match the reference screenshot exactly):
- Black background with thin gold horizontal rules dividing top/middle/bottom bands.
- Center: large gold-ringed circular timer with thin tick marks. Inside: "Level N" label, MM:SS countdown, "Next Break MM:SS" subtitle.
- Top-left: "Players" / "Entries" / "Re-Entries" labels (blue) with values (white).
- Top-right: "Level N" label and "smallBlind / bigBlind / (ante)" formatted like "100 / 200 / (200)".
- Middle-right: "Total Prize Pool" + dollar amount, then ranked payouts ("1st...$X", "2nd...$X", etc) with dotted leader lines.
- Middle-left: chip stack graphics showing the active denominations from the tournament's chip set (use SVG, no images).
- Bottom-left: "Total" chip count, "Average" stack with BB count.
- Bottom-right: "Next Level" with the upcoming blind values.
- Bottom strip: status text like "(Re-)Entry until the end of Level N" or break info.

Implementation:
- Route: app/tv/page.tsx — server component reading the active tournament for this device. If no tournament, show a "Waiting for tournament..." placeholder with same styling.
- Subscribe via Supabase Realtime to: tournaments (current level, current_blind_time, isRunning), tournament_players (count, total chips, avg).
- The timer ticks client-side for smoothness; sync drift to Supabase every 5 seconds.
- During a break, swap the layout: show "BREAK — N:NN remaining" prominently, with a panel listing players who've busted/rebought during the previous segment, plus next-level blinds. If the break has a colorUp value, show "Color up: $X, $Y chips" prominently.
- When a colorUp is active, show a QR code (use `qrcode.react` or similar) linking to /play/[sessionId] for color-up requests. Place it bottom-right of the TV.
- Use Tailwind for layout. For the gold clock ring + ticks, use SVG.
- Components should live in /components/tv/ — small, composable: ClockRing.tsx, BlindLevel.tsx, PrizePool.tsx, ChipStack.tsx, PlayerStats.tsx, BreakPanel.tsx, BottomBanner.tsx.
- /lib/timer/ contains the client-side tick hook and drift-sync logic.

DO NOT TOUCH:
- /app/admin (Track B)
- /app/play (Track C)
- /lib/prize-math, /lib/color-up, /lib/recurrence, /lib/uht-import (separate tracks)
- /supabase/migrations/0001_*.sql (foundation — read-only reference)

Deliver a /tv page that renders correctly with the seed tournament data even before any admin actions exist. Test by setting tournament.is_running=true and current_blind_level=3 manually in Supabase and confirming the TV shows L3 blinds, ticking timer, and correct chip/blind/prize displays.
```

---

## TRACK B — Admin Shell + Auth + Tournament Config (depends on Phase 0)

**Branch:** `feat/admin-shell`
**File scope:** `/app/admin/`, `/app/auth/`, `/lib/auth/`, `/middleware.ts`, `/components/admin/`

**Prompt:**

```
You are building the admin surface for a poker tournament app. Read these first:
- /Users/travisstoner/Documents/Claude/Projects/Poker/BUILD_PLAN.md
- /Users/travisstoner/Documents/Claude/Projects/Poker/seed/bluff-and-baffoons.json

Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker

Admin is used primarily on a phone during poker night. Mobile-first, large tap targets, no fiddly forms.

Tasks:
1. Auth flow: /app/auth/login/page.tsx — email magic link via Supabase. /app/auth/callback/route.ts handles the token exchange. middleware.ts gates /app/admin/* — redirect non-admins to /auth/login.
2. /lib/auth/ — server-side helper getAdminUser(), isAdmin() that checks the admins table.
3. /app/admin/layout.tsx — bottom-nav phone layout: Home, Tournament, Players, History, Settings.
4. /app/admin/page.tsx — dashboard showing: active tournament (if any) with quick actions (advance level, pause, mark player out), or "Start Tournament" button if none active.
5. /app/admin/tournaments/new/page.tsx — wizard: pick template → confirm settings → select tonight's players from master roster → start.
6. /app/admin/tournaments/[id]/page.tsx — live admin view during a tournament: player grid (in/out/rebuy buttons per player), level controls (pause/play/advance), color-up request inbox, finalize button.
7. /app/admin/players/page.tsx — master player roster CRUD (name, signal handle, active/inactive in queue).
8. /app/admin/templates/page.tsx — tournament template CRUD — wraps the seeded "Bluff and Baffoons" template, allows editing buy-in, starting stack, rebuy rules, blind structure (drag-to-reorder levels), prize distribution rules. Use a tabbed interface.
9. /app/admin/settings/page.tsx — Signal config (group ID, enable [PokerBot] sending), recurring tournament schedule (cron-like UI for "3rd Friday every month").
10. All forms use react-hook-form + zod.
11. All mutations use Server Actions.
12. Phone-friendly: minimum tap target 44px, no horizontal scroll, sticky bottom action bars.

DO NOT TOUCH:
- /app/tv (Track A)
- /app/play (Track C)
- /lib/prize-math, /lib/color-up, /lib/recurrence (separate tracks — IMPORT them when ready, don't reimplement)
- /supabase/migrations/

Critical: When integrating with the prize math library (/lib/prize-math, Track D), import it but don't modify it. Same for /lib/color-up and /lib/recurrence. If those tracks aren't merged yet, stub the import with a TODO and a working mock that returns plausible values so the admin UI is testable.

Deliverable: a working admin app where Travis can log in via magic link, see the seeded "Bluff and Baffoons" template, edit it, start a tournament with selected players, and mark players in/out — all from a phone-sized viewport.
```

---

## TRACK C — Player Lightweight View (depends on Phase 0)

**Branch:** `feat/player-view`
**File scope:** `/app/play/`, `/lib/presence/`, `/components/player/`

**Prompt:**

```
You are building the no-account player view for a poker tournament app. Read these first:
- /Users/travisstoner/Documents/Claude/Projects/Poker/BUILD_PLAN.md
- /Users/travisstoner/Documents/Claude/Projects/Poker/seed/bluff-and-baffoons.json

Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker

The player view is what people land on when they scan the QR on the TV. No accounts. The session ID in the URL ties their browser to a specific tournament.

Critical UX rule: only one browser session can claim each player slot at a time. If they close the tab, the claim must release within ~30 sec so they can re-open and reclaim. Use Supabase Realtime PRESENCE for this — NOT a database column.

Tasks:
1. /app/play/[sessionId]/page.tsx — entry page. Server-fetches tournament_players for that tournament with a JOIN to players. Excludes any names currently claimed (by checking presence channel state on the server via a tracking table or by gating the UI on the client after presence sync).
2. Client component PickName.tsx: lists un-claimed names as big tap buttons. On click, joins the Supabase presence channel `tournament:{sessionId}:players` with payload { player_id, anon_session: <browser-generated UUID stored in sessionStorage> }. Once joined, presence holds the claim.
3. /lib/presence/ — abstraction over Supabase presence. usePlayerClaim() hook handles join/leave, tab-close detection (visibilitychange + beforeunload), reclaim on remount.
4. After claim, redirect to /app/play/[sessionId]/[playerSlug]/page.tsx — the player's home view. Tabs: Stats (their tournament stats), Color up (request form), Bust (self-report — sends to admin queue).
5. Color-up form: input chip total, calls /lib/color-up library (Track E) to compute exchange recommendation. On submit, inserts into color_up_requests table. Shows "Bring $X to admin: <breakdown>".
6. Stats tab: shows current chip count, position, BBs remaining, payout if busted now (uses /lib/prize-math from Track D).
7. Bust tab: tap "I'm out" → confirmation → marks tournament_players.busted_at = now. Optimistic update.
8. Mobile-only design — assume phone viewport. Large fonts, single-column.

DO NOT TOUCH:
- /app/tv (Track A)
- /app/admin (Track B)
- /lib/prize-math, /lib/color-up (separate tracks — IMPORT them; if not yet merged, mock them)
- /supabase/migrations/

Deliverable: a player can scan QR (URL provided manually for testing), pick their name, and see their stats. Closing the tab releases their claim. Two browsers attempting the same name: one wins, the other sees the name as un-pickable.
```

---

## TRACK D — Prize Math Library (CAN START BEFORE PHASE 0)

**Branch:** `lib/prize-math`
**File scope:** `/lib/prize-math/` only — pure TypeScript, no infra deps

**Prompt:**

```
You are writing a pure-TypeScript prize-payout calculation library for a poker tournament app. ZERO infrastructure dependencies — no database, no React, no Next.js. Just TypeScript + Vitest.

Read this for context: /Users/travisstoner/Documents/Claude/Projects/Poker/seed/bluff-and-baffoons.json

Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker
Module path: /lib/prize-math/

Set up the package:
- /lib/prize-math/index.ts — main API
- /lib/prize-math/index.test.ts — Vitest tests
- /lib/prize-math/types.ts — exported types

Public API:

  type PrizeRule =
    | { kind: 'fixed'; position: number; value: number }
    | { kind: 'percentRemainder'; position: number; value: number }      // % after fixed payouts subtracted
    | { kind: 'percentTotal'; position: number; value: number };          // % of full pool

  type PrizeConfig = {
    rules: PrizeRule[];
    rounding: { increment: 0 | 1 | 5 | 10 | 20; surplusToFirst: boolean };
    guarantee?: number;
    overlay?: boolean;  // if true and pool < guarantee, the host eats the diff
  };

  type Pool = {
    buyIns: number;
    buybacks: number;       // count of buyback tokens redeemed (regardless of mode); each contributes price to pool
    rakePerEntry?: number;
  };

  function computePayouts(config: PrizeConfig, pool: Pool): Array<{ position: number; amount: number }>;

Calculation rules (must implement EXACTLY):
1. Total pool = ((buyIns + buybacks) * buyInPrice) - (entries * rakePerEntry). Pass buyInPrice as part of config or derive from caller — clarify in your types.
2. If guarantee > pool and overlay=true, use guarantee as effective pool.
3. Subtract sum of all 'fixed' rules from pool. Remainder is what 'percentRemainder' rules split.
4. 'percentRemainder' rules: amount = floor(remainder * pct / 100 / increment) * increment if increment > 0; else just floor.
5. 'percentTotal' rules: amount = floor(pool * pct / 100 / increment) * increment.
6. After computing all rounded amounts, any leftover pool dollars go to 1st place if surplusToFirst=true; otherwise stays unallocated (return as remainder field).
7. Floor (round down) is the default for percentages — never round up. Increment 0 means cents.

Write tests covering Travis's actual config:
- $20 buy-in × 5 entries = $100 pool
- Rules: 1st 70% remainder, 2nd 30% remainder, 3rd $20 fixed
- Rounding: $10 increment, surplus to first
- Expected: 3rd=$20, remainder=$80, 2nd=$20 (30% = $24 → floor to $20), 1st=$50 (70% = $56 → floor to $50), surplus $10 → 1st becomes $60. Total $20+$20+$60=$100 ✓.
- Add tests for: 0 entries, large fields (50 players), no rebuys, overlay activation, increment 0/1/5/20.

Property test: total payouts always equal total pool when overlay=true (or when pool ≥ guarantee).

DO NOT TOUCH any other directory. Do not add Supabase or React. This is a standalone library.

Deliverable: passing tests, exported types, README in /lib/prize-math/README.md with API docs and the worked example above.
```

---

## TRACK E — Color-Up Calculator (CAN START BEFORE PHASE 0)

**Branch:** `lib/color-up`
**File scope:** `/lib/color-up/` only — pure TypeScript

**Prompt:**

```
Pure-TS library for color-up exchange calculations. ZERO infra deps. TypeScript + Vitest.

Read: /Users/travisstoner/Documents/Claude/Projects/Poker/seed/bluff-and-baffoons.json — note the chipDenominations array.

Module path: /lib/color-up/
Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker

Public API:

  type Denomination = { color: string; value: number };

  function computeExchange(args: {
    submittedTotal: number;        // dollar value of chips player handed in
    removingDenominations: number[]; // chip values being colored up away (e.g. [1, 5])
    remainingDenominations: Denomination[]; // active denoms after color-up
    roundingMode: 'up' | 'down';   // up = host gives player extra change; down = player owes nothing extra
  }): {
    exchangeFor: Array<{ value: number; count: number }>;   // chip counts to give back
    netChange: number;             // positive = player owes more, negative = player gets cash back, 0 = exact
    newTotal: number;              // dollar value of returned chips
  };

Algorithm:
1. Determine target value:
   - 'down': floor submittedTotal to the smallest remaining denomination.
   - 'up':   ceil submittedTotal to the smallest remaining denomination.
2. Greedy from largest remaining denomination down: integer-divide remaining target by denom, that's the count, subtract.
3. netChange = newTotal - submittedTotal (positive = player owes; negative = host owes player).

Tests covering Travis's example:
- removing [1, 5], remaining [10, 25, 100], submittedTotal=23, roundingMode='up' → newTotal=25, exchangeFor=[{value:25,count:1}], netChange=+2 (player owes $2 more).
- Same but 'down' → newTotal=20, exchangeFor=[{value:10,count:2}], netChange=-3 (host owes player $3).
- submittedTotal=100, removing [1,5], remaining [10,25,100] → either mode, 100 exact, exchangeFor=[{100,1}].
- submittedTotal=147, removing [1,5,10], remaining [25,100], 'down' → 125 = 1×100 + 1×25, netChange=-22.
- Edge: submittedTotal=0 → empty exchangeFor, netChange=0.

DO NOT TOUCH any other directory.

Deliverable: passing tests, /lib/color-up/README.md with API and worked example.
```

---

## TRACK F — Recurrence Rule Library (CAN START BEFORE PHASE 0)

**Branch:** `lib/recurrence`
**File scope:** `/lib/recurrence/` only

**Prompt:**

```
Pure-TS library for human-friendly recurring tournament schedules. ZERO infra deps.

Module path: /lib/recurrence/
Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker

Public API:

  type RecurrenceRule =
    | { kind: 'nthWeekdayOfMonth'; nth: 1|2|3|4|-1; weekday: 0|1|2|3|4|5|6 } // -1 = last
    | { kind: 'everyNDays'; n: number }
    | { kind: 'specificDates'; dates: string[] };  // ISO

  function nextOccurrence(rule: RecurrenceRule, after: Date, holidaysToSkip?: Date[]): Date;
  function nextNOccurrences(rule: RecurrenceRule, after: Date, n: number, holidaysToSkip?: Date[]): Date[];
  function describe(rule: RecurrenceRule): string; // human description e.g. "3rd Friday of each month"

Travis's case: { kind: 'nthWeekdayOfMonth', nth: 3, weekday: 5 } → "3rd Friday of each month".

Holiday handling: if computed date is in holidaysToSkip, advance to the next occurrence of the rule and try again (max 12 iterations to prevent infinite loops).

Tests:
- 3rd Friday from 2026-05-07 → 2026-05-15 ✓ (next 3rd Fri).
- 3rd Friday from 2026-05-15 → 2026-05-15 (same day counts as 'after' if NOT inclusive; document the convention — exclusive: → 2026-06-19).
- Last Saturday of month from 2026-05-07 → 2026-05-30.
- Holiday skip: 3rd Friday from 2026-12-01, holidays=[2026-12-18] → 2027-01-15.
- describe() returns correct strings for all rule kinds.

Use date-fns (`pnpm add date-fns` is fine — it's a small pure-JS lib). Do NOT use moment.

DO NOT TOUCH any other directory.

Deliverable: passing tests, /lib/recurrence/README.md.
```

---

## TRACK G — UHT Backup Importer (CAN START BEFORE PHASE 0)

**Branch:** `lib/uht-import`
**File scope:** `/lib/uht-import/` only

**Prompt:**

```
Pure-TS library to parse ultimate-holdem-timer.com `.backup` files (base64-encoded JSON) into our app's tournament_template format.

Module path: /lib/uht-import/
Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker
Reference fixture: /Users/travisstoner/Documents/Claude/Projects/Poker/seed/bluff-and-baffoons.json (the parsed output) and the original file at /Users/travisstoner/Library/Application Support/Claude/local-agent-mode-sessions/f535d3c4-c4f0-450f-8670-7dc08272af19/d094a05f-dd43-4f66-8ed5-cdca40e8b36b/local_dda258e8-defd-4e62-9a2b-3dd8fd6f7fb3/uploads/uht_backup_11_15_2025.backup.

Public API:

  function parseUhtBackup(base64Contents: string): {
    version: string;
    tournaments: TournamentTemplate[];
  };

  function uhtTournamentToTemplate(uhtT: any): TournamentTemplate;

Where TournamentTemplate matches the shape in seed/bluff-and-baffoons.json.

Mapping rules:
- buyIn → buyIn, startingStack → startingStack
- allowReentry, reentryPrice, reentryChips, reentryCount, finalReentryLevel → rebuy.{...}
- blindStructure: each level → { level: i+1, smallBlind, bigBlind, ante, durationMin: duration, isBreak: !!break, colorUp: parse "1, 5" string into [1,5] }
- prizeDistribution.staticDistribution: array of "70%", "30%", "20" → rules array with kind based on % suffix or absent
- prizeDistribution.roundPrizes → rounding.increment
- denominationDesign.chips filtered to value > 0 → chipDenominations
- startingStackConfig.chips filtered to amount > 0 → startingStackComposition
- defaultAnte === 'BB' → anteMode: 'BB'

Tests:
- Round-trip: parse the bundled fixture (place a copy at /lib/uht-import/__fixtures__/bluff-and-baffoons.backup), compare output to seed/bluff-and-baffoons.json. Acceptable diffs allowed: comment fields. Use deep equality with allowlisted ignored keys.
- Malformed input throws InvalidUhtBackupError with a useful message.

DO NOT TOUCH any other directory.

Deliverable: passing tests, /lib/uht-import/README.md.
```

---

## TRACK H — signal-cli Setup on Mac Mini (CAN START BEFORE PHASE 0, totally independent)

**Branch:** `infra/signal-cli`
**File scope:** `/scripts/signal-cli/` only

**Prompt:**

```
You are setting up a signal-cli REST bridge on a Mac Mini that's always on. It will be called by our poker tournament app to send Signal group messages prefixed [PokerBot]. Phone number registered with Signal: Travis's personal number (he'll fill in the actual value).

Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker
Module path: /scripts/signal-cli/

Tasks:
1. Pick the simplest viable approach. Recommended: bbernhard/signal-cli-rest-api in Docker — exposes a small HTTP API. Uses signal-cli under the hood.
2. Write /scripts/signal-cli/docker-compose.yml that runs the bridge on localhost:8080 with persistent volume for signal data.
3. Write /scripts/signal-cli/README.md with step-by-step setup:
   - Install Docker Desktop on Mac Mini (link).
   - Run docker-compose up -d.
   - Register or link Travis's phone number (provide BOTH paths: register a NEW number, or link as a secondary device to an existing Signal install — link is preferred so his main phone stays usable).
   - Find the group ID via the API.
   - Test send.
4. Write /scripts/signal-cli/send.ts — a thin TypeScript helper that the Next.js app will import server-side. It posts to the bridge URL (env: SIGNAL_BRIDGE_URL) and PREPENDS "[PokerBot] " to every message body. Provide functions sendToGroup(groupId, body) and sendToNumber(phoneNumber, body).
5. Write /scripts/signal-cli/test-send.ts — a CLI-style script that takes a group ID and message and sends it, for smoke testing.
6. Networking: since the Mac Mini is on the home network and Vercel is in the cloud, recommend Cloudflare Tunnel as the primary option (Travis already manages DNS for holdemclock.com at Cloudflare, so this lines up naturally — expose the bridge at e.g. `signal.holdemclock.com` with Cloudflare Access policy restricting to the Vercel egress IPs or to authenticated Cloudflare service tokens). Provide step-by-step setup. Tailscale is the documented backup option. Do NOT recommend public-internet exposure without Cloudflare Access in front of it.
7. Security: include an HMAC shared-secret check on the bridge. The Next.js app signs requests with SIGNAL_BRIDGE_SECRET and the bridge rejects unsigned requests. Add a tiny middleware shim in front of the container if needed (e.g., nginx in the same compose file).

DO NOT TOUCH any other directory.

Deliverable: a working signal-cli setup recipe Travis can follow, a callable send helper, smoke test, and clear notes on networking + secrets management. The Next.js app will integrate this in a later track — do NOT touch /app or /lib outside /scripts.
```

---

## INTEGRATION PHASE (after parallel tracks merge)

Once Tracks A through H are merged to `main`, run a final integration pass.

**Branch:** `feat/integration-pass`

**Prompt:**

```
All parallel tracks have merged to main. Verify integration and fill gaps.

Working directory: /Users/travisstoner/Documents/Claude/Projects/Poker

Tasks:
1. Replace any TODO/mock imports of /lib/prize-math, /lib/color-up, /lib/recurrence, /lib/uht-import in /app/admin and /app/play with real imports. Run all tests.
2. Wire admin's "advance level" / "mark out" / "rebuy" actions to write tournament_events rows.
3. Wire color-up requests from /app/play/[sessionId]/.../color-up to display in /app/admin/tournaments/[id]/ inbox panel.
4. Wire signal-cli helper into:
   a. A Vercel cron job that sends a reminder N days before next tournament (configurable in admin settings).
   b. The "finalize tournament" admin action — generates a recap message via Track G's templates and sends.
5. Build the /app/admin/history dashboard — uses tournament_events for analytics. Charts: bust-time histogram, rebuy rate over time, player win rate, season leaderboard.
6. End-to-end test: simulate a full tournament from start to finalize. Verify TV display updates real-time, player view claim/release works across browsers, prize math matches expected, Signal recap posts to test group.
7. README polish — quickstart, screenshots, deploy guide.
8. Add a CHANGELOG with the phases captured.

Report any inconsistencies or schema gaps found during integration.
```

---

## How to run this in parallel

1. **Travis runs Phase 0** in one Claude Code session (or does it himself). Confirms it builds, the schema is applied, env vars are set, deployed to Vercel.
2. **Travis pushes `phase-0-foundation` branch** and merges to `main`.
3. **Travis spins up 4-5 Claude Code instances in parallel**, each on a separate branch:
   - 1 instance per UI track (A, B, C)
   - 1 instance handling library tracks (D, E, F, G — these are quick)
   - 1 instance handling Track H
4. **As each track passes tests and CR, merge to `main`.**
5. **Travis runs the integration pass.**

Estimated total elapsed time if running 4 instances in parallel: 1-2 days of Claude Code work, vs ~1 week sequential.
