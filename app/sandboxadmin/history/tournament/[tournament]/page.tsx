import TournamentHistoryBody from "@/components/admin/TournamentHistoryBody";

export const dynamic = "force-dynamic";

export default async function SandboxTournamentPage({
  params,
}: {
  params: Promise<{ tournament: string }>;
}) {
  const { tournament } = await params;
  return (
    <TournamentHistoryBody
      tournamentId={tournament}
      isSandbox={true}
      listBasePath="/sandboxadmin/history"
    />
  );
}
