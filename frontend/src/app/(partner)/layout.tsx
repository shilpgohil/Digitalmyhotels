import { RequireAuth } from "@/components/auth/require-auth";
import { PartnerSidebar } from "@/components/layout/partner-sidebar";
import { HotelSuspendedOverlay, SubscriptionGate } from "@/components/subscription/subscription-gate";
import { ImageEditorProvider } from "@/components/media/image-editor";
import { PageTransition } from "@/components/ui/page-transition";

export default function PartnerLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <RequireAuth>
      <ImageEditorProvider>
        {/* Hotel-suspended overlay fires instantly via CustomEvent from api/client.ts.
            Renders on top of everything so staff can't accidentally use the app
            while the hotel is deactivated by the platform. */}
        <HotelSuspendedOverlay />
        <div className="flex h-screen overflow-hidden">
          <div className="hidden lg:block">
            <PartnerSidebar />
          </div>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <SubscriptionGate />
            <PageTransition className="flex min-w-0 flex-1 flex-col overflow-hidden">
              {children}
            </PageTransition>
          </div>
        </div>
      </ImageEditorProvider>
    </RequireAuth>
  );
}
