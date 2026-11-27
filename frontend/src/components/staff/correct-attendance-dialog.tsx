"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { fmtApiDate } from "@/lib/formatting";
import type { AttendanceRecordOut } from "@/types/staff";

export interface AttendanceEditTarget {
  record_id: string | null;
  staff_profile_id: string;
  user_id?: string | null;
  full_name: string;
  staff_code: string;
  work_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string;
}

const EDITABLE_STATUSES = [
  "present",
  "late",
  "absent",
  "leave",
  "off",
  "holiday",
] as const;

function toTimeInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function combineDateAndTime(workDate: string, timeStr: string): string | null {
  if (!timeStr) return null;
  const d = new Date(`${workDate}T${timeStr}:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function CorrectAttendanceDialog({
  target,
  onClose,
}: {
  readonly target: AttendanceEditTarget | null;
  readonly onClose: () => void;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, user } = useAuth();
  const queryClient = useQueryClient();

  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [status, setStatus] = useState("present");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setCheckInTime(toTimeInput(target.check_in_at));
    setCheckOutTime(toTimeInput(target.check_out_at));
    setStatus(
      EDITABLE_STATUSES.includes(
        target.status as (typeof EDITABLE_STATUSES)[number],
      )
        ? target.status
        : "present",
    );
    setNote("");
    setError(null);
  }, [target]);

  const isSelf = Boolean(target?.user_id && user?.id && target.user_id === user.id);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("Missing target");
      if (isSelf) throw new Error(t("cannotEditOwnAttendance"));

      const inIso = combineDateAndTime(target.work_date, checkInTime);
      let outIso = combineDateAndTime(target.work_date, checkOutTime);
      if (inIso && outIso && new Date(outIso) <= new Date(inIso)) {
        // Support overnight checkout past midnight if checkout time < checkin time.
        const nextDay = new Date(`${target.work_date}T00:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        const yyyy = nextDay.getFullYear();
        const mm = String(nextDay.getMonth() + 1).padStart(2, "0");
        const dd = String(nextDay.getDate()).padStart(2, "0");
        outIso = combineDateAndTime(`${yyyy}-${mm}-${dd}`, checkOutTime);
      }

      const trimmedNote = note.trim();
      if (trimmedNote.length < 3) {
        throw new Error(t("correctionNoteRequired"));
      }

      if (target.record_id) {
        return api<AttendanceRecordOut>(
          `/api/v1/staff/attendance/records/${target.record_id}`,
          {
            method: "PATCH",
            body: {
              check_in_at: inIso,
              check_out_at: outIso,
              status,
              note: trimmedNote,
            },
          },
        );
      }
      return api<AttendanceRecordOut>(
        `/api/v1/staff/${target.staff_profile_id}/attendance/correct`,
        {
          method: "POST",
          body: {
            work_date: target.work_date,
            check_in_at: inIso,
            check_out_at: outIso,
            status,
            note: trimmedNote,
          },
        },
      );
    },
    onSuccess: () => {
      toast.success(t("correctionSaved"));
      queryClient.invalidateQueries({
        queryKey: ["staff-attendance", activeHotelId],
      });
      queryClient.invalidateQueries({
        queryKey: ["staff-record-detail", activeHotelId],
      });
      queryClient.invalidateQueries({ queryKey: ["staff", activeHotelId] });
      onClose();
    },
    onError: (e) => {
      setError(e instanceof ApiError || e instanceof Error ? e.message : tc("error"));
    },
  });

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-4 text-gold-600" aria-hidden />
            {t("editAttendance")}
          </DialogTitle>
        </DialogHeader>

        {target && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              mutation.mutate();
            }}
          >
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <p className="font-semibold text-foreground">{target.full_name}</p>
              <p className="text-xs text-muted-foreground">
                {target.staff_code} · {fmtApiDate(target.work_date)}
              </p>
            </div>

            {isSelf ? (
              <p className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">
                {t("cannotEditOwnAttendance")}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ca-in">{t("checkInCol")}</Label>
                    <Input
                      id="ca-in"
                      type="time"
                      value={checkInTime}
                      onChange={(e) => setCheckInTime(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ca-out">{t("checkOutCol")}</Label>
                    <Input
                      id="ca-out"
                      type="time"
                      value={checkOutTime}
                      onChange={(e) => setCheckOutTime(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ca-status">{t("statusCol")}</Label>
                  <select
                    id="ca-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="h-[42px] w-full rounded-lg border border-input bg-background px-2.5 text-sm"
                  >
                    {EDITABLE_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {t(`att_${st}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ca-note">{t("correctionNote")}</Label>
                  <Textarea
                    id="ca-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    required
                    minLength={3}
                    maxLength={1000}
                    rows={2}
                    placeholder={t("correctionNotePlaceholder")}
                  />
                </div>
              </>
            )}

            {error && (
              <p className="text-sm text-danger" role="alert">
                {error}
              </p>
            )}

            <DialogFooter>
              <DialogClose className="inline-flex h-[42px] items-center justify-center rounded-lg bg-[#d1d1d1] px-5 text-sm font-medium text-foreground hover:bg-[#bebebe] transition-colors">
                {tc("cancel")}
              </DialogClose>
              {!isSelf && (
                <Button type="submit" disabled={mutation.isPending}>
                  {mutation.isPending ? tc("saving") : tc("save")}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
