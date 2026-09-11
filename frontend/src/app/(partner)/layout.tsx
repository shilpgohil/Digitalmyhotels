import { RequireAuth } from "@/components/auth/require-auth";
import { PartnerSidebar } from "@/components/layout/partner-sidebar";
import { PartnerMobileTabBar } from "@/components/layout/partner-mobile-tab-bar";
import { HotelSuspendedOverlay, SubscriptionGate } from "@/components/subscription/subscription-gate";
import { ImageEditorProvider } from "@/components/media/image-editor";
import { PageTransition } from "@/components/ui/page-transition";

export default function PartnerLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <RequireAuth>
      <ImageEditorProvider>
        {/*
         * SKIP TO CONTENT — keyboard / screen-reader accessibility.
         * Hidden by default; becomes visible on :focus-within so Tab-key
         * users can skip past the sidebar navigation on every page load.
         */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to main content
        </a>

        {/* Hotel-suspended overlay fires instantly via CustomEvent from api/client.ts.
            Renders on top of everything so staff can't accidentally use the app
            while the hotel is deactivated by the platform. */}
        <HotelSuspendedOverlay />

        <div className="flex h-screen overflow-hidden">
          {/* Fixed 256px navy sidebar — always expanded (classic frame) */}
          <div className="hidden lg:block w-64 shrink-0">
            <PartnerSidebar />
          </div>

          {/* Main content */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <SubscriptionGate />
            <PageTransition id="main-content" className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {/* Tab bar floats over content — no reserved bottom pad (client request) */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {children}
              </div>
            </PageTransition>
          </div>
        </div>

        {/* Mobile bottom tab bar — Apple-style floating glass pill */}
        <PartnerMobileTabBar />
      </ImageEditorProvider>
    </RequireAuth>
  );
}
