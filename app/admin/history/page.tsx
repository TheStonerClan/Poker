import { redirect } from "next/navigation";

/**
 * Historics moved to the public path /history (linked from the
 * holdemclock.com landing menu) so guests / players / family can see
 * leaderboards without an admin account. The admin nav still lists
 * "History" but it now points at /history directly. This redirect
 * keeps any bookmarked /admin/history URLs working.
 */
export default async function AdminHistoryRedirect({
  searchParams,
}: {
  searchParams: Promise<{ template?: string; range?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams();
  // The new page only honors `range` (the old template filter is no
  // longer surfaced on the public page). Forward range when present;
  // template is intentionally dropped.
  if (sp.range) params.set("range", sp.range);
  const qs = params.toString();
  redirect(qs ? `/history?${qs}` : "/history");
}
