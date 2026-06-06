#!/usr/bin/env -S npx tsx
// Manual test sender for the "1 week until poker night" reminder.
//
// Edit the FIXTURE block below to tweak copy / data, then:
//   set -a; source .env; set +a
//   export SIGNAL_BRIDGE_URL=http://localhost:8080
//   export SIGNAL_FROM_NUMBER=+19166226116
//   export SIGNAL_SANDBOX_GROUP_ID='group.OS83NDdSQi9TcHBmMUlxUUhQZlhVTVZkSnBXeHZYdlVnUmlpWmZTdFhLST0='
//
//   npx tsx send-week-out.ts             # send to sandbox
//   npx tsx send-week-out.ts --dry-run   # print to stdout, do not send

import { sendToGroup } from './send';
import { buildWeekOutMessage, type WeekOutInput } from './messages/week-out';

// ──────────── FIXTURE ────────────  edit freely while iterating
const fixture: WeekOutInput = {
  tournamentName: 'Bluffs and Buffoons',
  // Next 3rd-Friday tournament — June 19 2026 7:30 PM Central (CDT = UTC-5).
  date: new Date('2026-06-19T19:30:00-05:00'),
  timezone: 'America/Chicago',
  location: 'Jarrell',
};
// ──────────── /FIXTURE ────────────

async function main() {
  const message = buildWeekOutMessage(fixture);
  const dryRun = process.argv.includes('--dry-run');

  if (dryRun) {
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
