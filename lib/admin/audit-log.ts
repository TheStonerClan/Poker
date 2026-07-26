import { formatChips } from "@/lib/admin/format";

export type AuditLogEntry = {
  id: string;
  type: "bust" | "rebuy" | "addon" | "chip_adjust";
  createdAt: string;
  playerName: string;
  description: string;
  undone: boolean;
};

/**
 * Plain-English one-liner for an audit log row, built from the raw
 * event payload. Lives outside `AuditLog.tsx` (a "use client" module)
 * because the tournament detail page — a Server Component — needs to
 * call it directly while building `entries`; Next's RSC bundler only
 * lets a server module render a client module's exported *components*,
 * not call its exported plain functions.
 */
export function formatAuditDescription(
  type: AuditLogEntry["type"],
  payload: Record<string, unknown>,
): string {
  const level = payload.at_level as number | null | undefined;
  if (type === "bust") return `Out at L${level ?? "?"}`;
  if (type === "rebuy") {
    const chips = payload.chips as number | undefined;
    return `Rebuy at L${level ?? "?"} (+${formatChips(chips ?? 0)})`;
  }
  if (type === "addon") {
    const chips = payload.chips_added as number | undefined;
    return `Add-on at L${level ?? "?"} (+${formatChips(chips ?? 0)})`;
  }
  // chip_adjust
  const before = payload.before as number | undefined;
  const after = payload.after as number | undefined;
  const reason = payload.reason as string | null | undefined;
  return `${formatChips(before ?? 0)} → ${formatChips(after ?? 0)}${reason ? ` — ${reason}` : ""}`;
}
