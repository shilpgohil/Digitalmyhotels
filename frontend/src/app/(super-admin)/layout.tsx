import { RequireAuth } from "@/components/auth/require-auth";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import { AdminHeader } from "@/components/layout/admin-header";
import { ImageEditorProvider } from "@/components/media/image-editor";
import { PageTransition } from "@/components/ui/page-transition";

export default function SuperAdminLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <RequireAuth superAdminOnly>
      <ImageEditorProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <div className="flex h-screen overflow-hidden">
        {/* Fixed 256px navy sidebar — always expanded (matches partner) */}
        <div className="hidden lg:block w-64 shrink-0">
          <AdminSidebar />
        </div>
        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AdminHeader />
          <PageTransition id="main-content" className="flex-1 overflow-y-auto">
            {children}
          </PageTransition>
        </div>
      </div>
      </ImageEditorProvider>
    </RequireAuth>
  );
}
