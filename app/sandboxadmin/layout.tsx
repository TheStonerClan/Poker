import { redirect } from "next/navigation";

import { SandboxBottomNav } from "@/components/admin/SandboxBottomNav";
import { getUser, isAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Sandbox admin shell — same admin gate as /admin (no separate auth
 * model; any real admin can use the sandbox), but its own bottom nav
 * scoped to sandbox-only routes. Non-admins never had a sandbox use
 * case (unlike /admin's table-admin handoff), so this is a simple
 * two-way fork.
 */
export default async function SandboxAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/auth/login");

  const admin = await isAdmin(user.email ?? null);
  if (!admin) redirect("/");

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom,0)]">
        {children}
      </div>
      <SandboxBottomNav />
    </div>
  );
}
