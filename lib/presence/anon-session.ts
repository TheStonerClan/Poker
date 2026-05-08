const STORAGE_KEY = "holdem-clock:anon-session";

/**
 * Per-tab UUID used as the Realtime presence key for a player claim.
 *
 * sessionStorage (not localStorage) so a fresh tab gets a fresh identity —
 * this lets the same human re-open a name on a new tab without colliding
 * with the soon-to-time-out previous tab. Persisting across navigation
 * inside the same tab is what enables seamless reclaim when going from
 * the picker to the player home.
 */
export function getOrCreateAnonSession(): string {
  if (typeof window === "undefined") {
    throw new Error("getOrCreateAnonSession must run in the browser");
  }
  let v = window.sessionStorage.getItem(STORAGE_KEY);
  if (!v) {
    v = crypto.randomUUID();
    window.sessionStorage.setItem(STORAGE_KEY, v);
  }
  return v;
}
