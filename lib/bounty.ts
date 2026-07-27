/**
 * Shared bounty constant, importable from both server and client code
 * (unlike `lib/admin/bounty.ts`, which is `server-only` since it queries
 * the database to resolve the target).
 *
 * IMPORTANT: this is the amount taken out of the prize pool EACH WEEK a
 * bounty is active — not the total bounty amount shown to players. When
 * a bounty stacks (goes unclaimed and carries to the next tournament),
 * `tournaments.bounty_amount` grows to the running total (e.g. $40 after
 * one unclaimed week), but only BASE_BOUNTY_AMOUNT ever comes out of any
 * single week's pool — the rest was already deducted from a prior
 * week's pool and just sits carried over. A 13-entry, $20-buy-in night
 * with a stacked $40 bounty still only pulls $20 out of that week's
 * $260 pool ($240 to the prize pool), not the full $40.
 */
export const BASE_BOUNTY_AMOUNT = 20;
