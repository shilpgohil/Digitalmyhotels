import { RequireAuth } from "@/components/auth/require-auth";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminHeader } from "@/components/layout/admin-header";

export default function SuperAdminLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <RequireAuth superAdminOnly>
      <div className="flex h-screen overflow-hidden">
        <div className="hidden lg:block">
          <AdminSidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AdminHeader />
          <div className="flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    </RequireAuth>
  );
}
