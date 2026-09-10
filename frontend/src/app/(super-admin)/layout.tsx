import { RequireAuth } from "@/components/auth/require-auth";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminHeader } from "@/components/layout/admin-header";
import { ImageEditorProvider } from "@/components/media/image-editor";
import { PageTransition } from "@/components/ui/page-transition";

export default function SuperAdminLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <RequireAuth superAdminOnly>
      <ImageEditorProvider>
      <div className="flex h-screen overflow-hidden">
        {/* w-60 here so AdminSidebar (now w-full) fills exactly 240px on desktop */}
        <div className="hidden lg:block w-60 shrink-0">
          <AdminSidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AdminHeader />
          <PageTransition className="flex-1 overflow-y-auto">
            {children}
          </PageTransition>
        </div>
      </div>
      </ImageEditorProvider>
    </RequireAuth>
  );
}
