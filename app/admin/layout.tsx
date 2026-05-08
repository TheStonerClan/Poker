import { BottomNav } from "@/components/admin/BottomNav";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <div className="flex flex-1 flex-col pb-[env(safe-area-inset-bottom,0)]">
        {children}
      </div>
      <BottomNav />
    </div>
  );
}
