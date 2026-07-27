import PlayerHistoryBody from "@/components/admin/PlayerHistoryBody";

export const dynamic = "force-dynamic";

type SearchParams = { range?: string };

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ player: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { player } = await params;
  return (
    <PlayerHistoryBody
      searchParams={searchParams}
      isSandbox={false}
      listBasePath="/history"
      playerId={player}
    />
  );
}
