// Server-side helper the Next.js app imports to push messages through the
// signal-cli REST bridge running on the Mac Mini.
//
// All outbound messages are prefixed with "[PokerBot] " so recipients can
// identify the source at a glance and filter on it if needed.
//
// Required env (server-side only — never expose to the browser):
//   SIGNAL_BRIDGE_URL      e.g. https://signal.holdemclock.com
//   SIGNAL_BRIDGE_SECRET   shared HMAC secret matching the proxy container
//   SIGNAL_FROM_NUMBER     the registered/linked Signal number, e.g. +15551234567
//
// Optional env (set when the bridge is published behind Cloudflare Access):
//   CF_ACCESS_CLIENT_ID
//   CF_ACCESS_CLIENT_SECRET

import crypto from 'node:crypto';

const PREFIX = '[PokerBot] ';

type SendResult = { timestamp?: number; [key: string]: unknown };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sign(secret: string, method: string, path: string, body: string): {
  signature: string;
  timestamp: string;
} {
  const timestamp = Date.now().toString();
  const payload = `${timestamp}\n${method}\n${path}\n${body}`;
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return { signature: `sha256=${digest}`, timestamp };
}

async function postSigned<T = SendResult>(path: string, body: object): Promise<T> {
  const bridgeUrl = requireEnv('SIGNAL_BRIDGE_URL').replace(/\/+$/, '');
  const secret = requireEnv('SIGNAL_BRIDGE_SECRET');

  const json = JSON.stringify(body);
  const { signature, timestamp } = sign(secret, 'POST', path, json);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-signature': signature,
    'x-timestamp': timestamp,
  };

  const cfId = process.env.CF_ACCESS_CLIENT_ID;
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfId && cfSecret) {
    headers['CF-Access-Client-Id'] = cfId;
    headers['CF-Access-Client-Secret'] = cfSecret;
  }

  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers,
    body: json,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`signal bridge ${path} → ${res.status}: ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}

function normalizeGroupRecipient(groupId: string): string {
  return groupId.startsWith('group.') ? groupId : `group.${groupId}`;
}

export async function sendToGroup(groupId: string, body: string): Promise<SendResult> {
  const fromNumber = requireEnv('SIGNAL_FROM_NUMBER');
  return postSigned('/v2/send', {
    message: `${PREFIX}${body}`,
    number: fromNumber,
    recipients: [normalizeGroupRecipient(groupId)],
  });
}

export async function sendToNumber(phoneNumber: string, body: string): Promise<SendResult> {
  const fromNumber = requireEnv('SIGNAL_FROM_NUMBER');
  return postSigned('/v2/send', {
    message: `${PREFIX}${body}`,
    number: fromNumber,
    recipients: [phoneNumber],
  });
}
