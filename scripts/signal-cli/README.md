# signal-cli REST bridge

A localhost HTTP bridge that lets the Next.js poker app push Signal messages
prefixed `[PokerBot] ` to a tournament group. Runs on the always-on Mac Mini.

Stack:

- **bbernhard/signal-cli-rest-api** — wraps `signal-cli` with a small REST API.
- **HMAC proxy** (custom Node container in `./proxy`) — sits in front of the
  REST API, validates `X-Signature` / `X-Timestamp` against `SIGNAL_BRIDGE_SECRET`,
  rejects everything else.
- **Cloudflare Tunnel** — primary path for Vercel → Mac Mini, with Cloudflare
  Access service token gating.
- **Tailscale Funnel** — documented backup.

```
Vercel (Next.js) ──HTTPS+HMAC──▶ Cloudflare Tunnel ──▶ proxy:8080 ──▶ signal-cli-rest-api:8080
                                  (Access service token)   (HMAC verify)        (json-rpc daemon)
```

---

## 1. Install Docker Desktop on the Mac Mini

1. Download from <https://www.docker.com/products/docker-desktop/>.
2. Install, launch, sign in.
3. Settings → General → enable **Start Docker Desktop when you log in**.
4. macOS → System Settings → Users & Groups → enable **Automatic login** for
   the Mac Mini's account so Docker comes back up after a reboot. (Skip this
   if you'd rather log in manually after power events.)

Verify:

```sh
docker --version
docker compose version
```

## 2. Configure secrets and bring the stack up

From `/scripts/signal-cli`:

```sh
cp .env.example .env
# Generate a strong shared secret and paste it into .env as SIGNAL_BRIDGE_SECRET
openssl rand -hex 32
```

Stand the stack up:

```sh
docker compose up -d --build
docker compose ps           # both containers should be "running"
docker compose logs -f      # tail until you see the bridge ready
```

Ports after startup:

| Port (bound to 127.0.0.1) | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `:8080`                   | HMAC proxy — what production traffic uses.    |
| `:8081`                   | Raw signal-cli REST API — setup only.         |

The signal data lives in `./signal-data/`. **Back this directory up.** Losing
it requires re-registering / re-linking the number.

## 3. Connect Travis's phone number

Pick **one** of the two paths below. **Linking is preferred** because it lets
the existing Signal install on Travis's phone keep working — the Mac Mini just
becomes a secondary device. Registration claims the number entirely.

### Path A — Link as a secondary device (preferred)

This requires Signal already installed on Travis's phone.

1. Open the QR endpoint in a browser **on the Mac Mini**:

   ```
   http://localhost:8081/v1/qrcodelink?device_name=PokerBotBridge
   ```

   It returns a QR PNG.

2. On the phone: Signal → Settings → Linked Devices → Link New Device → scan
   the QR code on the Mac Mini's screen.

3. After a few seconds the Mac Mini appears under Linked Devices. The bridge
   can now send as Travis's number.

### Path B — Register a brand-new number

Only do this if you want a dedicated Signal number for the bot. Signal will
claim this number and existing Signal installs on it will be deactivated.

1. Captcha (Signal requires one for new registrations):

   - Open <https://signalcaptchas.org/registration/generate.html> in a desktop
     browser, solve the captcha.
   - Open the browser devtools, copy the `signalcaptcha://...` URL the page
     produces. Strip the `signalcaptcha://` prefix — the rest is the captcha
     token.

2. Request the SMS code (replace number, captcha):

   ```sh
   NUMBER='+15551234567'
   CAPTCHA='03AGdBq25...'
   curl -X POST "http://localhost:8081/v1/register/${NUMBER}" \
     -H 'content-type: application/json' \
     -d "{\"use_voice\": false, \"captcha\": \"${CAPTCHA}\"}"
   ```

3. Verify with the SMS code Travis receives (`123-456` → `123456`):

   ```sh
   curl -X POST "http://localhost:8081/v1/register/${NUMBER}/verify/123456"
   ```

4. Set a profile name so messages don't show as "Unknown":

   ```sh
   curl -X PUT "http://localhost:8081/v1/profiles/${NUMBER}" \
     -H 'content-type: application/json' \
     -d '{"name": "PokerBot"}'
   ```

## 4. Find the group ID

Signal group IDs are long base64 strings.

```sh
NUMBER='+15551234567'
curl -s "http://localhost:8081/v1/groups/${NUMBER}" | jq
```

Look for the group's `name` and copy its `id` — it looks like
`group.bWVnYWdyb3VwLnRpdGxlLnRlc3RpbmctaWQtaGVyZQ==`. The `group.` prefix is
already included; `send.ts` also accepts the bare base64 value.

If the group doesn't appear yet, send any message into it from the phone — the
linked device picks up groups as it sees activity. You can also force-sync:

```sh
curl -X POST "http://localhost:8081/v1/receive/${NUMBER}"
```

## 5. Smoke test

From `/scripts/signal-cli`, with the `.env` values exported into the shell:

```sh
export SIGNAL_BRIDGE_URL=http://localhost:8080
export SIGNAL_BRIDGE_SECRET=<paste from .env>
export SIGNAL_FROM_NUMBER=+15551234567

npx tsx test-send.ts 'group.bWVnYWdyb3VwLnRpdGxlLnRlc3RpbmctaWQtaGVyZQ==' 'pairs of jacks just got cracked'
```

Expected: the message lands in the group with `[PokerBot] ` prefix, and the
script prints a JSON response containing a `timestamp`.

A quick negative test — same call without auth headers should be rejected:

```sh
curl -i -X POST http://localhost:8080/v2/send -H 'content-type: application/json' -d '{}'
# → HTTP/1.1 401 Unauthorized   {"error":"missing signature headers"}
```

---

## 6. Networking — Cloudflare Tunnel (primary)

Travis already manages `holdemclock.com` DNS at Cloudflare, so the tunnel
plus a Cloudflare Access policy is the cleanest path: no inbound holes in the
home router, TLS terminated at Cloudflare, and Vercel authenticates with a
service token.

### 6a. Install and authenticate `cloudflared` on the Mac Mini

```sh
brew install cloudflared
cloudflared tunnel login
# Browser opens; pick the holdemclock.com zone to authorize.
```

### 6b. Create the tunnel

```sh
cloudflared tunnel create signal-bridge
# Outputs a tunnel UUID and writes credentials to ~/.cloudflared/<UUID>.json
```

### 6c. Configure ingress

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <UUID-from-step-6b>
credentials-file: /Users/travisstoner/.cloudflared/<UUID>.json

ingress:
  - hostname: signal.holdemclock.com
    service: http://localhost:8080
  - service: http_status:404
```

### 6d. Route DNS

```sh
cloudflared tunnel route dns signal-bridge signal.holdemclock.com
```

### 6e. Run the tunnel as a launchd service

```sh
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

It will now start on boot. Logs:

```sh
sudo log stream --predicate 'process == "cloudflared"' --info
```

### 6f. Lock it down with Cloudflare Access

In the Cloudflare dashboard:

1. **Zero Trust → Access → Applications → Add an application → Self-hosted**.
   - Application name: `Poker Signal Bridge`
   - Subdomain: `signal`, Domain: `holdemclock.com`
   - Session duration: 24h (irrelevant for service tokens, but required).
2. **Policies → Add a policy**:
   - Name: `Allow Vercel`
   - Action: `Service Auth`
   - Include: `Service Token` → create a new token named
     `vercel-poker-app`. Save the **Client ID** and **Client Secret** — you
     will not see the secret again.
3. Optionally add a second policy `Allow Travis` with action `Allow` and
     `Emails` matching Travis's address, so you can `curl` from a logged-in
     browser session for debugging.

In Vercel, set these env vars (Production + Preview):

| Variable                    | Value                                   |
| --------------------------- | --------------------------------------- |
| `SIGNAL_BRIDGE_URL`         | `https://signal.holdemclock.com`        |
| `SIGNAL_BRIDGE_SECRET`      | same hex string as Mac Mini's `.env`    |
| `SIGNAL_FROM_NUMBER`        | `+15551234567` (Travis's actual number) |
| `CF_ACCESS_CLIENT_ID`       | from step 6f.2                          |
| `CF_ACCESS_CLIENT_SECRET`   | from step 6f.2                          |

Verify end-to-end from your laptop:

```sh
SIGNAL_BRIDGE_URL=https://signal.holdemclock.com \
SIGNAL_BRIDGE_SECRET=<hex> \
SIGNAL_FROM_NUMBER=+15551234567 \
CF_ACCESS_CLIENT_ID=<id> \
CF_ACCESS_CLIENT_SECRET=<secret> \
  npx tsx test-send.ts 'group.<id>' 'hello from cloud'
```

A request without the CF Access headers should hit the Cloudflare login page
(HTML), not the bridge.

## 7. Networking — Tailscale (backup)

Use this only if Cloudflare Tunnel is unavailable, or for ad-hoc debugging from
a Tailscale-connected laptop. Vercel Functions cannot natively join a tailnet,
so for production use you'd publish via **Tailscale Funnel** (which exposes the
service publicly with TLS), and rely on the proxy's HMAC for auth.

```sh
brew install --cask tailscale
# Sign in via the menu bar app.
sudo tailscale up
# Expose the proxy on your tailnet (private):
tailscale serve --bg --https=443 --set-path=/ http://localhost:8080
# OR expose publicly (with HMAC as the only auth):
tailscale funnel --bg --https=443 --set-path=/ http://localhost:8080
tailscale status
```

Then point `SIGNAL_BRIDGE_URL` at the resulting `*.ts.net` hostname. Funnel
gives you a less robust posture than Cloudflare Access — the HMAC is the
*only* gate — so prefer Cloudflare Tunnel where possible.

---

## 8. Security model and operational notes

- **HMAC at the proxy:** every production request must carry
  `X-Signature: sha256=<hex>` and `X-Timestamp: <unix-ms>` where the signature
  is `HMAC-SHA256(SIGNAL_BRIDGE_SECRET, ts + "\n" + method + "\n" + path + "\n" + body)`.
  Stale timestamps (>5 min skew) are rejected — replay attacks within that
  window are bounded by the sender's own client. The check is done with
  `crypto.timingSafeEqual` to avoid timing attacks.
- **Defense in depth:** Cloudflare Access service token authenticates the
  *caller* (Vercel); HMAC authenticates the *request* (so a leaked CF token
  alone can't send messages, and a leaked HMAC secret alone can't reach the
  bridge from outside the home network).
- **Setup port (8081) is localhost-only.** Never publish it through the tunnel.
- **Secret management:** `SIGNAL_BRIDGE_SECRET` lives in `.env` on the Mac Mini
  and as a Vercel env var. To rotate: change both in lockstep with a brief
  outage window, or run two valid secrets temporarily in the proxy if you need
  zero-downtime rotation.
- **Backups:** `signal-data/` contains the encryption keys for the linked
  device. A snapshot lets you restore without re-linking.

## 9. Common ops

```sh
# Restart everything (e.g., after editing docker-compose.yml or .env)
docker compose down && docker compose up -d --build

# Tail logs
docker compose logs -f signal-bridge-proxy
docker compose logs -f signal-cli-rest-api

# Receive (force-sync messages, useful after long inactivity)
curl -X POST "http://localhost:8081/v1/receive/${SIGNAL_FROM_NUMBER}"

# List linked devices
curl -s "http://localhost:8081/v1/devices/${SIGNAL_FROM_NUMBER}" | jq

# Update images
docker compose pull && docker compose up -d --build
```

## 10. Files in this directory

| Path                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `docker-compose.yml`  | Defines `signal-cli-rest-api` + `signal-bridge-proxy`. |
| `.env.example`        | Template for the `SIGNAL_BRIDGE_SECRET` value.         |
| `proxy/`              | Node.js HMAC proxy image source.                       |
| `send.ts`             | Server-side helper for the Next.js app to import.      |
| `test-send.ts`        | CLI smoke test that calls `sendToGroup`.               |
| `signal-data/`        | Persistent signal-cli state (created on first run).    |
