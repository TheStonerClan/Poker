/**
 * Slugify a player's display name for use in `/play/[sessionId]/[playerSlug]`.
 * Lowercase, ASCII-fold, collapse non-alphanumeric runs to "-", trim hyphens.
 *
 * The slug is *not* a primary key — the server route resolves it by hashing
 * every roster name through this same function and matching. Collisions are
 * unlikely because the players table has a `lower(name)` unique index.
 */
export function slugifyPlayerName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
