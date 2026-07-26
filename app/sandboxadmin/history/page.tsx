import HistoryBody from "@/components/admin/HistoryBody";

export const dynamic = "force-dynamic";

type SearchParams = { range?: string };

export default async function SandboxHistoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  return (
    <HistoryBody
      searchParams={searchParams}
      isSandbox={true}
      basePath="/sandboxadmin/history"
      homeHref="/sandboxadmin"
    />
  );
}
