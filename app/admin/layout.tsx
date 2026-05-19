import { redirect } from "next/navigation";

import { BottomNav } from "@/components/admin/BottomNav";
import { getUser, isAdmin } from "@/lib/auth";
import { getCurrentSeatedTable } from "@/lib/auth/table-admin";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Three-way fork:
  //   - Not signed in → bounce to login as before.
  //   - Global admin → render the admin shell.
  //   - Signed in but not an admin → if they're a linked roster spot
  //     currently seated at a running tournament, hand them off to
  //     their table page; otherwise back to the public landing. This
  //     prevents the "login → /admin → no auth → /auth/login" loop
  //     for table admins, who don't have admins-table membership.
  const user = await getUser();
  if (!user) redirect("/auth/login");

  const admin = await isAdmin(user.email ?? null);
  if (!admin) {
    const seat = await getCurrentSeatedTable();
    if (seat) {
      redirect(`/table/${seat.tournament_id}/${seat.table_number}`);
    }
    redirect("/");
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom,0)]">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
