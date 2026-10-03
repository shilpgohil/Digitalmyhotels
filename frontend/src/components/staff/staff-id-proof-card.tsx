"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  FileBadge,
  Upload,
  Eye,
  Trash2,
  RefreshCw,
  Loader2,
  ShieldCheck,
  AlertCircle,
  Download,
  FileText,
} from "lucide-react";
import { SectionPanel } from "@/components/ui/section-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/feedback/status-badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { API_BASE, getAccessToken, apiUpload, api } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { toast } from "sonner";
import type { StaffOut } from "@/types/staff";

interface StaffIdProofCardProps {
  staff: StaffOut;
  onUpdated?: () => void;
}

export function StaffIdProofCard({ staff, onUpdated }: StaffIdProofCardProps) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can(PERMISSIONS.staffManage);

  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch authenticated ID proof blob if staff has ID proof
  useEffect(() => {
    if (!staff.has_id_proof || !activeHotelId || !canManage) {
      setPreviewSrc(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(`${API_BASE}/api/v1/staff/${staff.id}/id-proof`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "X-Hotel-Id": activeHotelId,
          },
          credentials: "include",
        });

        if (!res.ok || cancelled) {
          if (!cancelled) setPreviewSrc(null);
          return;
        }

        const type = res.headers.get("Content-Type") || "image/jpeg";
        setMediaType(type);
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewSrc(objectUrl);
      } catch {
        if (!cancelled) setPreviewSrc(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [staff.id, staff.has_id_proof, activeHotelId, canManage]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeHotelId) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error(t("idProofTooLarge"));
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      await apiUpload(`/api/v1/staff/${staff.id}/id-proof`, formData, {
        hotelId: activeHotelId,
      });

      toast.success(t("idProofUploadedToast"));
      queryClient.invalidateQueries({ queryKey: ["staff", activeHotelId] });
      onUpdated?.();
    } catch {
      toast.error(t("idProofUploadFailed"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDelete = async () => {
    if (!activeHotelId) return;
    setDeleting(true);
    try {
      await api(`/api/v1/staff/${staff.id}/id-proof`, {
        method: "DELETE",
        hotelId: activeHotelId,
      });

      toast.success(t("idProofDeletedToast"));
      setShowDeleteConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["staff", activeHotelId] });
      onUpdated?.();
    } catch {
      toast.error(t("idProofDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const isPdf = mediaType?.includes("pdf") ?? false;

  return (
    <>
      <SectionPanel
        title={t("idProofTitle")}
        icon={FileBadge}
        action={
          staff.has_id_proof ? (
            <StatusBadge tone="success" className="gap-1">
              <ShieldCheck className="size-3.5" aria-hidden />
              {t("idProofUploaded")}
            </StatusBadge>
          ) : (
            <StatusBadge tone="neutral" className="gap-1">
              <AlertCircle className="size-3.5" aria-hidden />
              {t("noIdProof")}
            </StatusBadge>
          )
        }
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            {staff.has_id_proof ? (
              <div
                className="relative flex size-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-muted/40 shadow-xs hover:opacity-90 transition-opacity"
                onClick={() => previewSrc && setShowViewModal(true)}
                title={t("viewIdProof")}
              >
                {loading ? (
                  <Loader2 className="size-6 animate-spin text-muted-foreground" />
                ) : isPdf ? (
                  <div className="flex flex-col items-center justify-center text-navy-900">
                    <FileText className="size-8" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">PDF</span>
                  </div>
                ) : previewSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewSrc}
                    alt="ID Proof"
                    className="size-full object-cover"
                  />
                ) : (
                  <FileBadge className="size-8 text-muted-foreground" />
                )}
              </div>
            ) : (
              <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-input bg-muted/20 text-muted-foreground">
                <FileBadge className="size-8 stroke-1" />
              </div>
            )}

            <div className="space-y-1">
              <p className="text-sm font-semibold text-navy-950">
                {staff.has_id_proof
                  ? t("idProofVerifiedHeadline")
                  : t("idProofMissingHeadline")}
              </p>
              <p className="text-xs text-muted-foreground max-w-md">
                {canManage
                  ? staff.has_id_proof
                    ? t("idProofManagedHint")
                    : t("idProofUploadHintAdmin")
                  : staff.has_id_proof
                    ? t("idProofStaffVerifiedNote")
                    : t("idProofStaffMissingNote")}
              </p>
            </div>
          </div>

          {/* Action buttons gated by permission */}
          <div className="flex flex-wrap items-center gap-2">
            {staff.has_id_proof && canManage && previewSrc && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setShowViewModal(true)}
              >
                <Eye className="size-4" aria-hidden />
                {t("viewIdProof")}
              </Button>
            )}

            {canManage && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <Button
                  variant={staff.has_id_proof ? "outline" : "default"}
                  size="sm"
                  className={staff.has_id_proof ? "h-9 gap-1.5" : "h-9 gap-1.5 bg-navy-900 text-white hover:bg-navy-800"}
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : staff.has_id_proof ? (
                    <RefreshCw className="size-4" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  {staff.has_id_proof ? t("replaceIdProof") : t("uploadIdProof")}
                </Button>

                {staff.has_id_proof && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2.5 text-danger hover:bg-danger-bg hover:text-danger"
                    onClick={() => setShowDeleteConfirm(true)}
                    title={t("deleteIdProof")}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </SectionPanel>

      {/* View ID Proof Modal */}
      <Dialog open={showViewModal} onOpenChange={setShowViewModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-navy-950">
              <FileBadge className="size-5 text-gold-600" />
              {t("idProofModalTitle", { name: staff.full_name })}
            </DialogTitle>
          </DialogHeader>

          <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg border bg-navy-950/5 p-3">
            {isPdf ? (
              <iframe
                src={previewSrc ?? ""}
                className="h-[60vh] w-full rounded border-0"
                title="ID Proof Document"
              />
            ) : previewSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewSrc}
                alt="ID Proof"
                className="max-h-[60vh] max-w-full rounded object-contain shadow-sm"
              />
            ) : null}
          </div>

          <DialogFooter className="flex flex-row justify-between sm:justify-between items-center gap-2 pt-2">
            <span className="text-xs text-muted-foreground">
              {t("idProofConfidentialNotice")}
            </span>
            <div className="flex gap-2">
              {previewSrc && (
                <a
                  href={previewSrc}
                  download={`id-proof-${staff.staff_code}`}
                  className={buttonVariants({
                    variant: "outline",
                    size: "sm",
                    className: "gap-1.5",
                  })}
                >
                  <Download className="size-4" />
                  {tc("download")}
                </a>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowViewModal(false)}
              >
                {tc("close")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-danger">
              {t("confirmDeleteIdProofTitle")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t("confirmDeleteIdProofDesc", { name: staff.full_name })}
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              disabled={deleting}
              onClick={() => setShowDeleteConfirm(false)}
            >
              {tc("cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={handleDelete}
              className="gap-1.5"
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              {tc("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
