import AdminDashboardBody from "@/components/admin/AdminDashboardBody";

export const dynamic = "force-dynamic";

export default async function SandboxAdminDashboardPage() {
  return <AdminDashboardBody isSandbox={true} />;
}
