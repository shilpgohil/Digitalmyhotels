import { RequireAuth } from "@/components/auth/require-auth";
import { PartnerSidebar } from "@/components/layout/partner-sidebar";
import { SubscriptionGate } from "@/components/subscription/subscription-gate";

export default function PartnerLayout({ children }: { readonly children: React.ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex h-screen overflow-hidden">
        <div className="hidden lg:block">
          <PartnerSidebar />
        </div>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <SubscriptionGate />
          {children}
        </div>
      </div>
    </RequireAuth>
  );
}
