#!/usr/bin/env -S npx tsx
// Smoke test: posts a single message to a Signal group through the bridge.
//
// Usage (from /scripts/signal-cli, with .env exported into the shell):
//   export SIGNAL_BRIDGE_URL=http://localhost:8080
//   export SIGNAL_BRIDGE_SECRET=<same value as docker .env>
//   export SIGNAL_FROM_NUMBER=+15551234567
//   npx tsx test-send.ts "group.<base64-id>" "hello from the bridge"
//
// Or against the public Cloudflare Tunnel hostname with CF Access creds set.

import { sendToGroup } from './send';

async function main() {
  const [, , groupId, ...messageParts] = process.argv;
  const message = messageParts.join(' ');

  if (!groupId || !message) {
    console.error('Usage: tsx test-send.ts <group-id> <message...>');
    process.exit(1);
  }

  const result = await sendToGroup(groupId, message);
  console.log('sent:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
