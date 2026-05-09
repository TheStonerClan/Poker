/**
 * Tiny UUID-ish generator that works on every browser the player view
 * might land on, including iOS Safari < 15.4 (where `crypto.randomUUID`
 * doesn't exist and calling it throws `TypeError: crypto.randomUUID is
 * not a function`).
 *
 * The IDs aren't cryptographic — they only need to be unique-enough
 * within a tournament's presence channel and per-tab session storage.
 *
 * Strategy:
 *   1. Use the platform `crypto.randomUUID()` when available.
 *   2. Otherwise, fall back to a v4-shaped string built from
 *      `crypto.getRandomValues` (still secure, supported back to iOS 7).
 *   3. Otherwise (no crypto at all — only some embedded WebViews),
 *      use `Math.random` as last resort.
 */
export function safeRandomId(): string {
  const c =
    typeof globalThis !== "undefined"
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;

  if (c?.randomUUID) {
    return c.randomUUID();
  }

  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    // Set v4 + variant bits per RFC 4122.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
      .slice(6, 8)
      .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  // Absolute fallback. Math.random is fine here — the IDs are only
  // for client-side scoping (presence keys, sessionStorage tags).
  const rand = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0");
  return `${rand()}${rand()}-${rand().slice(0, 4)}-4${rand().slice(0, 3)}-${rand().slice(0, 4)}-${rand()}${rand().slice(0, 4)}`;
}
