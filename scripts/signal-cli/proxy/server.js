// HMAC-authenticating reverse proxy for the signal-cli REST bridge.
//
// Accepts JSON requests from the Next.js app, validates an HMAC signature
// over (timestamp + method + path + body), then forwards to the internal
// signal-cli-rest-api container. Bare Node (no Express) — fewer deps to audit.

const http = require('http');
const crypto = require('crypto');

const SECRET = process.env.SIGNAL_BRIDGE_SECRET;
const UPSTREAM = (process.env.UPSTREAM_URL || 'http://signal-cli-rest-api:8080').replace(/\/+$/, '');
const PORT = parseInt(process.env.PORT || '8080', 10);
const MAX_SKEW_MS = parseInt(process.env.MAX_SKEW_MS || '300000', 10);

if (!SECRET || SECRET.length < 32) {
  console.error('SIGNAL_BRIDGE_SECRET is required and must be at least 32 chars');
  process.exit(1);
}

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'x-signature',
  'x-timestamp',
]);

function reject(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function verify(req, body) {
  const sig = req.headers['x-signature'];
  const ts = req.headers['x-timestamp'];
  if (typeof sig !== 'string' || typeof ts !== 'string') return 'missing signature headers';

  const tsNum = parseInt(ts, 10);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > MAX_SKEW_MS) {
    return 'timestamp out of range';
  }

  const payload = `${ts}\n${req.method}\n${req.url}\n${body.toString('utf8')}`;
  const expected = `sha256=${crypto.createHmac('sha256', SECRET).update(payload).digest('hex')}`;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'invalid signature';
  return null;
}

const server = http.createServer(async (req, res) => {
  // Unauthenticated liveness check for Docker / Cloudflare health probes.
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const reason = verify(req, body);
  if (reason) {
    return reject(res, 401, reason);
  }

  const upstreamUrl = `${UPSTREAM}${req.url}`;
  const fwHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) fwHeaders[k] = v;
  }

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method,
      headers: fwHeaders,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    });
    const responseBody = Buffer.from(await upstreamRes.arrayBuffer());
    const respHeaders = {};
    upstreamRes.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) respHeaders[key] = value;
    });
    res.writeHead(upstreamRes.status, respHeaders);
    res.end(responseBody);
  } catch (err) {
    console.error('upstream error', err);
    reject(res, 502, 'upstream unreachable');
  }
});

server.listen(PORT, () => {
  console.log(`signal-bridge-proxy listening on :${PORT} → ${UPSTREAM}`);
});
