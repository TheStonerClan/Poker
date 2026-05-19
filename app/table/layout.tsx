export const dynamic = "force-dynamic";

/**
 * Layout for the table-admin scoped view. Intentionally minimal — no
 * admin bottom nav (the audience is either a real admin who can find
 * the full admin nav via /admin, or a seated player whose only
 * destination here is their own table). Page-level gating happens
 * inside `[tournamentId]/[tableNumber]/page.tsx`.
 */
export default function TableLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom,0)]">
        {children}
      </div>
    </div>
  );
}
