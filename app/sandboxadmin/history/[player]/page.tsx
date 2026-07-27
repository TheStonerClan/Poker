import PlayerHistoryBody from "@/components/admin/PlayerHistoryBody";

export const dynamic = "force-dynamic";

type SearchParams = { range?: string };

export default async function SandboxPlayerPage({
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
      isSandbox={true}
      listBasePath="/sandboxadmin/history"
      playerId={player}
    />
  );
}
