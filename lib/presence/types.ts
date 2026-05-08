/**
 * Per-tab claim payload broadcast on the
 * `tournament:{sessionId}:players` Realtime presence channel.
 *
 * The presence *key* is `anon_session` so two tabs can never overwrite each
 * other's entry. Conflict resolution (two tabs claiming the same player_id)
 * is deterministic on `claimed_at`, with `anon_session` as the tiebreaker.
 */
export type PresencePayload = {
  player_id: string;
  anon_session: string;
  claimed_at: string;
};

export function presenceChannelName(sessionId: string): string {
  return `tournament:${sessionId}:players`;
}
