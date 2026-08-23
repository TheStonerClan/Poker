import { formatChips, formatMoney } from "@/lib/admin/format";

export type TimelineEvent = {
  id: string;
  type: string;
  createdAt: string;
  description: string;
};

export type RawEvent = {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

function str(payload: Record<string, unknown> | null, key: string): string | null {
  const v = payload?.[key];
  return typeof v === "string" ? v : null;
}

function num(payload: Record<string, unknown> | null, key: string): number | null {
  const v = payload?.[key];
  return typeof v === "number" ? v : null;
}

/**
 * Full "chain of events" for one tournament's detail page — every row
 * from tournament_events (append-only, so this is the complete real
 * history, corrections included) turned into a plain-English line.
 * `undo` events are shown as their own line rather than hidden or
 * retroactively striking the original, matching the append-only
 * philosophy: nothing here is erased, just narrated in order.
 */
export function buildTournamentTimeline(args: {
  events: RawEvent[];
  nameByPlayerId: Map<string, string>;
  nameByTournamentPlayerId: Map<string, string>;
  levelLabel: (levelNum: number | null | undefined) => string;
}): TimelineEvent[] {
  const { events, nameByPlayerId, nameByTournamentPlayerId, levelLabel } = args;

  const playerName = (payload: Record<string, unknown> | null): string => {
    const pid = str(payload, "player_id");
    if (pid) return nameByPlayerId.get(pid) ?? "Someone";
    return "Someone";
  };

  const rows: TimelineEvent[] = events.map((e) => {
    const p = e.payload;
    let description: string;

    switch (e.type) {
      case "bust":
        description = `${playerName(p)} busted out at ${levelLabel(num(p, "at_level"))}`;
        break;
      case "rebuy":
        description = `${playerName(p)} rebought at ${levelLabel(num(p, "at_level"))} (+${formatChips(num(p, "chips") ?? 0)})`;
        break;
      case "addon":
        description = `${playerName(p)} added on at ${levelLabel(num(p, "at_level"))} (+${formatChips(num(p, "chips_added") ?? 0)})`;
        break;
      case "chip_adjust": {
        const before = num(p, "before") ?? 0;
        const after = num(p, "after") ?? 0;
        const reason = str(p, "reason");
        description = `${playerName(p)}'s chips: ${formatChips(before)} → ${formatChips(after)}${reason ? ` — ${reason}` : ""}`;
        break;
      }
      case "chip_snapshot": {
        const chips = num(p, "chips") ?? 0;
        description = `${playerName(p)} checked in at ${levelLabel(num(p, "level_num"))}: ${formatChips(chips)} chips`;
        break;
      }
      case "level_advance": {
        const to = num(p, "to_level");
        const back = str(p, "direction") === "back";
        description = `${back ? "Stepped back to" : "Advanced to"} ${levelLabel(to)}`;
        break;
      }
      case "level_pause": {
        const reason = str(p, "reason");
        description = `Clock paused${reason ? ` — ${reason.replace(/_/g, " ")}` : ""}`;
        break;
      }
      case "level_resume":
        description = "Clock resumed";
        break;
      case "finalize": {
        const chopped = p?.chopped_top_two === true;
        const auto = p?.auto === true;
        description = `Tournament finalized${chopped ? " (top 2 chopped)" : ""}${auto ? " — auto from last bust" : ""}`;
        break;
      }
      case "admin_note": {
        const kind = str(p, "kind");
        if (kind === "merge_tables") {
          description = `Tables merged (${num(p, "moved") ?? 0} players moved)`;
        } else if (kind === "seat_confirmation") {
          description = `Seating confirmed at table ${num(p, "table_number") ?? "?"}`;
        } else if (kind === "bounty_retired_credit") {
          const creditedId = str(p, "credited_player_id");
          const credited = creditedId
            ? (nameByPlayerId.get(creditedId) ?? "someone")
            : "someone";
          description = `Bounty program retired — ${formatMoney(num(p, "amount") ?? 0)} credited to ${credited} as winnings`;
        } else {
          description = "Admin note";
        }
        break;
      }
      case "knockout": {
        const victimId = str(p, "player_id");
        const knockerId = str(p, "knocked_out_by_player_id");
        const victim = victimId ? (nameByPlayerId.get(victimId) ?? "Someone") : "Someone";
        description = knockerId
          ? `${victim} was knocked out by ${nameByPlayerId.get(knockerId) ?? "someone"}`
          : `Knockout credit on ${victim} cleared`;
        break;
      }
      case "bounty_collected": {
        const targetId = str(p, "target_player_id");
        const collectorId = str(p, "collected_by_player_id");
        const amount = num(p, "amount") ?? 0;
        const target = targetId ? (nameByPlayerId.get(targetId) ?? "the target") : "the target";
        const collector = collectorId
          ? (nameByPlayerId.get(collectorId) ?? "someone")
          : "someone";
        description = `${collector} collected the ${formatMoney(amount)} bounty on ${target}`;
        break;
      }
      case "undo": {
        const undoneType = str(p, "undone_type") ?? "action";
        const tpId = str(p, "tournament_player_id");
        const who = tpId ? nameByTournamentPlayerId.get(tpId) : null;
        description = who
          ? `Undid a ${undoneType} for ${who}`
          : `Undid a ${undoneType}`;
        break;
      }
      default:
        description = e.type.replace(/_/g, " ");
    }

    return { id: e.id, type: e.type, createdAt: e.created_at, description };
  });

  rows.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return rows;
}
