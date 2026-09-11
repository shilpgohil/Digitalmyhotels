"use client";
/**
 * RevealIdButton — audited reveal of the full decrypted ID number for a
 * returning guest (client 9-08 item 8). Only rendered for roles holding
 * guests.view_full_id; every click is written to the audit log server-side.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InlineSpinner } from "@/components/ui/inline-spinner";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { PERMISSIONS } from "@/lib/permissions";

interface RevealIdButtonProps {
  guestId: string | null | undefined;
  onRevealed: (idNumber: string) => void;
}

export function RevealIdButton({ guestId, onRevealed }: RevealIdButtonProps) {
  const t = useTranslations("checkin");
  const tc = useTranslations("common");
  const api = useApi();
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!guestId || !can(PERMISSIONS.guestsViewFullId)) return null;

  const reveal = async () => {
    setBusy(true);
    try {
      const res = await api<{ id_number: string | null }>(
        `/api/v1/guests/${guestId}/reveal-id`,
        { method: "POST" },
      );
      if (res.id_number) {
        onRevealed(res.id_number);
        toast.success(t("savedIdLoaded"));
      } else {
        toast.info(t("noSavedId"));
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : tc("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="shrink-0"
      disabled={busy}
      onClick={() => void reveal()}
      title={t("revealSavedIdHint")}
    >
      {busy ? <InlineSpinner size={14} /> : <Eye className="size-3.5" aria-hidden />}
      {t("revealSavedId")}
    </Button>
  );
}
