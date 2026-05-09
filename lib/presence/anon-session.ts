import { safeRandomId } from "@/lib/safe-uuid";

const STORAGE_KEY = "holdem-clock:anon-session";
let inMemoryFallback: string | null = null;

/**
 * Per-tab UUID used as the Realtime presence key for a player claim.
 *
 * sessionStorage (not localStorage) so a fresh tab gets a fresh identity —
 * this lets the same human re-open a name on a new tab without colliding
 * with the soon-to-time-out previous tab. Persisting across navigation
 * inside the same tab is what enables seamless reclaim when going from
 * the picker to the player home.
 *
 * Browser-compat notes:
 * - safeRandomId() instead of crypto.randomUUID() directly: the latter
 *   throws on iOS Safari < 15.4. safe-uuid.ts has the fallback chain.
 * - sessionStorage is wrapped in try/catch: iOS Safari Private Browsing
 *   throws QUOTA_EXCEEDED on setItem and (in some versions) throws on
 *   getItem too. When that happens we keep an in-memory fallback so the
 *   picker still works — the only loss is reclaim across the picker →
 *   player-home navigation, which a private-browsing user implicitly
 *   accepted by not letting the site persist anything.
 */
export function getOrCreateAnonSession(): string {
  if (typeof window === "undefined") {
    throw new Error("getOrCreateAnonSession must run in the browser");
  }
  try {
    let v = window.sessionStorage.getItem(STORAGE_KEY);
    if (!v) {
      v = safeRandomId();
      window.sessionStorage.setItem(STORAGE_KEY, v);
    }
    return v;
  } catch {
    // sessionStorage unavailable (private browsing, embedded webview
    // with storage disabled, quota exceeded). Use a module-level
    // fallback so successive calls within the same page load return
    // the same id — losing only the picker → player-home reclaim.
    if (!inMemoryFallback) inMemoryFallback = safeRandomId();
    return inMemoryFallback;
  }
}
