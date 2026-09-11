"use client";

/** /staff/new — Add New Staff (client mockup). */

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PartnerHeader } from "@/components/layout/partner-header";
import { StaffForm } from "@/components/staff/staff-form";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

function AddStaffContent() {
  const t = useTranslations("staff");
  const tn = useTranslations("nav");
  const router = useRouter();

  return (
    <>
      <PartnerHeader title={t("addStaffTitle")} subtitle={tn("staffGroup")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-4xl">
          <p className="mb-4 text-sm text-muted-foreground">{t("addStaffSubtitle")}</p>
          <StaffForm onDone={(id) => router.push(`/staff/${id}`)} />
        </div>
      </main>
    </>
  );
}

export default function AddStaffPage() {
  return (
    <RequirePermission permission={PERMISSIONS.staffManage}>
      <AddStaffContent />
    </RequirePermission>
  );
}
