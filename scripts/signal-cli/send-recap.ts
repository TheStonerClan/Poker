#!/usr/bin/env -S npx tsx
// Manual test sender for the tournament recap.
//
// Default behavior: pulls the last completed tournament's data from Supabase,
// formats it, and sends to the sandbox group. The eventual finalization
// handler will call `loadRecapForTournament(id)` directly and follow the
// same code path.
//
// Env required (load with `set -a; source .env.local; source scripts/signal-cli/.env; set +a`):
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SIGNAL_BRIDGE_URL          (e.g. http://localhost:8080)
//   SIGNAL_BRIDGE_SECRET
//   SIGNAL_FROM_NUMBER
//   SIGNAL_SANDBOX_GROUP_ID    (required unless --dry-run)
//
// Flags:
//   --dry-run   Print the rendered message; do not send.
//   --fixture   Use hardcoded sample data instead of hitting Supabase.
//               Useful for iterating on the formatter without a live DB.
//   --id <uuid> Render a specific tournament instead of the latest finished.

import { sendToGroup } from './send';
import { buildRecapMessage, type RecapInput } from './messages/recap';
import {
  loadLastCompletedRecap,
  loadRecapForTournament,
} from './messages/load-last-recap';

const FIXTURE: RecapInput = {
  tournamentName: 'Bluffs and Buffoons',
  date: new Date('2026-05-19T19:00:00-07:00'),
  timezone: 'America/Los_Angeles',
  entries: 12,
  prizePool: 480,
  podium: [
    { place: 1, name: 'Mike', payout: 240 },
    { place: 2, name: 'Sarah', payout: 144 },
    { place: 3, name: 'Dave', payout: 96 },
  ],
  funFacts: {
    firstKnockout: {
      name: 'Jeff',
      blinds: { small: 20, big: 40 },
      minutesIntoLevel: 5,
    },
    firstEliminated: {
      name: 'Brian',
      blinds: { small: 50, big: 100 },
      minutesIntoLevel: 8,
    },
    longestSurvivor: { name: 'Lisa', durationMinutes: 252 },
    chipLeaderFirstBreak: { name: 'Travis', chips: 4500 },
    chipLeaderSecondBreak: { name: 'Connor', chips: 7800 },
    chipLeaderFinalTable: { name: 'Travis', chips: 12000 },
    biggestSwing: { name: 'Mike', delta: 3200, betweenBreaks: [1, 2] },
  },
  detailUrl: 'https://holdemclock.com/history/fixture',
};

function argFlag(name: string): boolean {
  return process.argv.includes(name);
}

function argValue(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function resolveInput(): Promise<RecapInput> {
  if (argFlag('--fixture')) return FIXTURE;
  const explicitId = argValue('--id');
  if (explicitId) return loadRecapForTournament(explicitId);
  return loadLastCompletedRecap();
}

async function main() {
  const input = await resolveInput();
  const message = buildRecapMessage(input);

  if (argFlag('--dry-run')) {
    console.log('───── message preview ─────');
    console.log(`[PokerBot] ${message}`);
    console.log('───── end preview ─────');
    console.log('(dry-run, not sent)');
    return;
  }

  const groupId = process.env.SIGNAL_SANDBOX_GROUP_ID;
  if (!groupId) {
    console.error('SIGNAL_SANDBOX_GROUP_ID is not set in environment');
    process.exit(1);
  }

  const result = await sendToGroup(groupId, message);
  console.log('sent:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
