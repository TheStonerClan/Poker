import type { PlayerCounts, TournamentPlayerWithName } from "./types";

export function aggregatePlayers(
  rows: TournamentPlayerWithName[],
): PlayerCounts {
  let entries = rows.length;
  let reEntries = 0;
  let addOns = 0;
  let activeChips = 0;
  let activePlayers = 0;

  for (const r of rows) {
    if (r.buyback_used && r.buyback_used_as === "rebuy") reEntries += 1;
    if (r.buyback_used && r.buyback_used_as === "addon") addOns += 1;
    if (r.busted_at_time == null) {
      activePlayers += 1;
      activeChips += r.current_chips ?? 0;
    }
  }

  // A rebuy is its own paid entry (buyback proceeds add to pool the same as
  // a buy-in), so the entries count is rows + rebuys.
  entries = rows.length + reEntries;

  const averageChips =
    activePlayers > 0 ? Math.round(activeChips / activePlayers) : 0;

  return {
    players: activePlayers,
    entries,
    reEntries,
    addOns,
    totalChips: activeChips,
    averageChips,
  };
}
