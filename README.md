# Holdem Clock

**Tournament timer + management for home games.**
Production: <https://holdemclock.com>

A three-surface app for running real-money home poker tournaments:

| Route | Audience | What it does |
|---|---|---|
| `/tv`              | Spectators (TV in the game room) | Read-only display of clock, blinds, prize pool, who's in/out, color-up alerts |
| `/admin`           | Tournament director (phone)      | Magic-link auth. Mark in/out, run rebuys, advance levels, finalize |
| `/play/[sessionId]`| Players (phone, via QR)          | Claim a name, request color-ups, see live stats |

All three surfaces stay in sync via Supabase Realtime.

The default tournament loaded by the seed is **"Bluff and Baffoons"** — Travis's
real recurring game in Jarrell. See [`seed/bluff-and-baffoons.json`](seed/bluff-and-baffoons.json)
for the source config.

---

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5**
- **Tailwind v4** (CSS-first config — design tokens live in [`app/globals.css`](app/globals.css))
- **Supabase** — Postgres + Auth (email magic link) + Realtime
- **Vercel** — hosting + custom domain
- **Cloudflare** — DNS only (proxy disabled — see [Domain & DNS](#domain--dns))
- **pnpm** — package manager

---

## Quickstart

```bash
# 1. Install deps
pnpm install

# 2. Set up local env
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# and SUPABASE_SERVICE_ROLE_KEY from the Supabase dashboard.

# 3. Run the dev server
pnpm dev
# → http://localhost:3000  (auto-redirects to /tv)
```

### Routes

- `/`                — redirects to `/tv`
- `/tv`              — TV display (stub)
- `/admin`           — admin dashboard (stub, will be auth-gated)
- `/play/[sessionId]` — player view (stub)

---

## Environment variables

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`        | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | client + server | Public anon key (safe to ship to browser) |
| `SUPABASE_SERVICE_ROLE_KEY`       | **server only** | Bypasses RLS — used for trusted server-side mutations (session claims, event log writes from webhooks). Never import in a Client Component. |

Set these in:
- `.env.local` for local dev (gitignored)
- Vercel project settings → Environment Variables for production

---

## Database

Schema lives in [`supabase/migrations/0001_initial_schema.sql`](supabase/migrations/0001_initial_schema.sql).
Seed lives in [`supabase/seed.sql`](supabase/seed.sql).

### Tables

- `players` — master roster (the inactive queue)
- `tournament_templates` — recurring config
- `blind_structures` — versioned reusable structures
- `tournaments` — one instance per night, snapshots all settings at launch
- `tournament_players` — per-player state (chips, claim, buyback, bust)
- `tournament_events` — append-only log
- `color_up_requests` — player-submitted exchange requests
- `prize_distributions` — payout snapshot
- `admins` — email allow-list backing the `is_admin()` helper

### Apply the migration + seed

```bash
# Install the Supabase CLI once
brew install supabase/tap/supabase

# Log in and link to your hosted project
pnpm dlx supabase login
pnpm dlx supabase link --project-ref <your-project-ref>

# Push the migration
pnpm dlx supabase db push

# Seed Bluff and Baffoons
pnpm dlx supabase db execute --file supabase/seed.sql
```

For local development with the full Supabase stack (Postgres + Studio + Auth + Realtime in Docker):

```bash
pnpm dlx supabase start
pnpm dlx supabase db reset   # applies migrations + seed.sql
```

### Add yourself as admin

Magic-link auth is wired up but admin permission is gated on the `admins` table.
After signing in once with magic link, run this in the SQL editor (or `psql`):

```sql
insert into public.admins (email) values ('you@example.com');
```

The `is_admin()` SQL helper checks `auth.jwt() ->> 'email'` against this table.

### Regenerate TypeScript types after schema changes

```bash
pnpm dlx supabase gen types typescript --linked --schema public \
  > lib/database.types.ts
```

The placeholder in [`lib/database.types.ts`](lib/database.types.ts) keeps the
app compiling until you've run this once.

---

## Deploy

### Vercel

1. From the Vercel dashboard, **Import Project** → pick `TheStonerClan/Poker`.
2. Framework preset: Next.js. Build command + output dir: defaults.
3. Add the three Supabase env vars under **Settings → Environment Variables**
   (Production + Preview + Development).
4. Deploy. First build should succeed against the stub pages.

### Domain & DNS

Custom domain is `holdemclock.com` (apex) + `www.holdemclock.com`.
DNS is managed in **Cloudflare**, but **Vercel handles the certificate and CDN**.
This means **the Cloudflare orange-cloud proxy must stay OFF** for both records,
or you'll get redirect loops, SSL handshake failures, and broken cert renewal.

**In Vercel:** Project → Settings → Domains → add both
`holdemclock.com` and `www.holdemclock.com`.

**In Cloudflare DNS, add the records Vercel prompts for — typically:**

| Type    | Name | Value                  | Proxy status              |
|---------|------|------------------------|---------------------------|
| `A`     | `@`  | `76.76.21.21`          | **DNS only (gray cloud)** |
| `CNAME` | `www`| `cname.vercel-dns.com` | **DNS only (gray cloud)** |

**In Cloudflare SSL/TLS settings:** set encryption mode to **Full (strict)** at the zone level.

After Cloudflare propagates (usually <2 min) Vercel will issue a Let's Encrypt cert automatically.

> **⚠️ Do not enable Cloudflare's proxy (orange cloud) on these records.**
> Vercel runs its own edge network and TLS termination; Cloudflare's proxy
> double-terminates TLS, breaks Vercel's automatic cert renewal, and causes
> redirect loops between `holdemclock.com` and `www.holdemclock.com`.

---

## Project structure

```
app/                  # Next.js App Router
  layout.tsx          # Root layout: Inter font, dark base styles
  page.tsx            # /  → redirects to /tv
  tv/page.tsx         # TV display (Phase 1)
  admin/page.tsx      # Admin dashboard (Phase 2, magic-link gated)
  play/[sessionId]/   # Player view (Phase 3)
  globals.css         # Tailwind v4 + design tokens (CSS variables)

components/           # Shared React components

lib/
  supabase/
    server.ts         # Server Component / Route Handler client (cookie-aware)
    client.ts         # Browser client for Client Components
  database.types.ts   # Generated Supabase types (placeholder until first gen)
  prize-math/         # Prize distribution engine (parallel track)
  recurrence/         # Recurring schedule helpers (parallel track)
  color-up/           # Color-up suggestion math (parallel track)

supabase/
  migrations/0001_initial_schema.sql
  seed.sql

scripts/              # Operational scripts (signal-cli, etc.)
seed/                 # Source-of-truth tournament configs (JSON)
```

---

## House rules

The default Bluff and Baffoons buyback rule (encoded in
`tournament_templates.buyback_config` and snapshotted onto every tournament):

- Each player starts with **one** buyback token.
- Spend it (a) when busted **on or before Level 6** for a fresh 500-chip stack at $20, or
- Spend it (b) at the **L8 break** to add 500 chips to your current stack for $20.
- Once spent in either mode, no more.
- Buyback proceeds add to the prize pool exactly like buy-ins.

See [`seed/bluff-and-baffoons.json`](seed/bluff-and-baffoons.json) and [`BUILD_PLAN.md`](BUILD_PLAN.md) for the full ruleset.

---

## Build phases

See [`BUILD_PLAN.md`](BUILD_PLAN.md). Phase 0 (this commit) is the foundation.
Phase 1 is the TV timer. Phases 2-7 ship feature-by-feature.
