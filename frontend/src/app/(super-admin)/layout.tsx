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
      {/* Page edge vignette — premium depth effect */}
      <div className="edge-vignette-top" aria-hidden />
      <div className="edge-vignette-bottom" aria-hidden />

      <div className="relative flex h-screen overflow-hidden bg-gradient-to-br from-[#efebe3]/60 via-background to-background">
        {/* Absolute overlay sidebar — no column boundary, no partition.
            Transparent when collapsed (just icons). Glass floats when hovered. */}
        <div className="hidden lg:block absolute left-0 top-0 bottom-0 z-30">
          <AdminSidebar />
        </div>
        {/* Content — 56px left indent reserves space for the icon strip */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden lg:pl-14">
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
