import Link from "next/link";

/**
 * Links a player's name to their profile page at `${basePath}/[player]`
 * — `basePath` is whatever the current surface's history list path is
 * ("/history" or "/sandboxadmin/history"), so a name clicked from the
 * real leaderboard goes to the real profile and sandbox stays sandbox.
 *
 * Lives in its own module (rather than on HistoryBody, which several
 * of its callers are imported by) so nothing creates a circular import
 * between HistoryBody and the tables/cohort lists it renders.
 */
export function PlayerLink({
  basePath,
  playerId,
  name,
}: {
  basePath: string;
  playerId: string;
  name: string;
}) {
  return (
    <Link
      href={`${basePath}/${playerId}`}
      className="font-semibold text-fg underline decoration-fg/20 underline-offset-2 hover:text-gold hover:decoration-gold/50"
    >
      {name}
    </Link>
  );
}
