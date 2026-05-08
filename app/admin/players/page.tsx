import { TopBar } from "@/components/admin/TopBar";
import { getPlayers } from "@/lib/admin/queries";

import { PlayersList } from "./PlayersList";
import { PlayerEditor } from "./PlayerEditor";

export const dynamic = "force-dynamic";

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; new?: string }>;
}) {
  const { edit, new: newPlayer } = await searchParams;
  const players = await getPlayers();
  const editing = edit ? players.find((p) => p.id === edit) ?? null : null;
  const isCreating = newPlayer !== undefined;

  return (
    <>
      <TopBar
        title="Players"
        subtitle={`${players.length} in roster`}
        action={
          !editing && !isCreating ? (
            <a
              href="/admin/players?new"
              className="rounded-md bg-gold px-3 py-2 text-xs font-semibold uppercase tracking-wider text-bg"
            >
              Add
            </a>
          ) : null
        }
      />
      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        {editing || isCreating ? (
          <PlayerEditor player={editing} />
        ) : (
          <PlayersList players={players} />
        )}
      </main>
    </>
  );
}
