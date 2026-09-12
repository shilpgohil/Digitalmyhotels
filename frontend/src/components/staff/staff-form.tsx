"use client";

/**
 * StaffForm — Add / Edit staff (client mockup "Add New Staff").
 * Three sections: Personal · Employment · Login Credentials & Access.
 * 42px controls per the platform form spec.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, IdCard, KeyRound, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { DatePicker } from "@/components/ui/date-picker";
import { TimeInput } from "@/components/ui/time-input";
import { SectionPanel } from "@/components/ui/section-panel";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { ApiError, apiUpload } from "@/lib/api/client";
import { useImageEditor } from "@/components/media/image-editor";
import { compressStaffPhoto } from "@/lib/compress-image";
import { localToday } from "@/lib/formatting";
import { cn } from "@/lib/utils";
import {
  STAFF_ACCESS_ROLES,
  STAFF_DEPARTMENTS,
  STAFF_EMPLOYMENT_TYPES,
  type StaffOut,
} from "@/types/staff";

const selectCls =
  "h-[42px] w-full rounded-md border border-input bg-white px-2.5 text-sm";

function genTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return `${out}!1`;
}

export function StaffForm({
  existing,
  onDone,
}: {
  /** When set, the form edits this staff member instead of creating one. */
  readonly existing?: StaffOut;
  readonly onDone: (staffId: string) => void;
}) {
  const t = useTranslations("staff");
  const tc = useTranslations("common");
  const api = useApi();
  const { activeHotelId, can } = useAuth();
  const queryClient = useQueryClient();
  const editor = useImageEditor();

  // Personal
  const [fullName, setFullName] = useState(existing?.full_name ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [dob, setDob] = useState(existing?.date_of_birth ?? "");
  const [gender, setGender] = useState(existing?.gender ?? "");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // Employment
  const [department, setDepartment] = useState(existing?.department ?? "reception");
  const [designation, setDesignation] = useState(existing?.designation ?? "");
  const [employmentType, setEmploymentType] = useState(
    existing?.employment_type ?? "full_time",
  );
  const [joiningDate, setJoiningDate] = useState(
    existing?.joining_date ?? localToday(),
  );
  const [shiftStart, setShiftStart] = useState(existing?.shift_start?.slice(0, 5) ?? "");
  const [shiftEnd, setShiftEnd] = useState(existing?.shift_end?.slice(0, 5) ?? "");
  const [weeklyOff, setWeeklyOff] = useState(
    existing?.weekly_off != null ? String(existing.weekly_off) : "",
  );
  const [baseSalary, setBaseSalary] = useState(existing?.base_salary ?? "");
  const [status, setStatus] = useState(existing?.status ?? "active");
  // Access
  const [accessRole, setAccessRole] = useState(existing?.role_code ?? "general_staff");
  const [tempPassword, setTempPassword] = useState(genTempPassword());

  const [error, setError] = useState<string | null>(null);

  const pickPhoto = async (file: File | null) => {
    if (!file) return;
    const edited = await editor.edit(file, { aspect: "square", maxDimension: 800 });
    if (!edited) return;
    // Compress after cropping — keeps profile photos small (≤800px, q0.85).
    const compressed = await compressStaffPhoto(edited);
    setPhoto(compressed);
    setPhotoPreview(URL.createObjectURL(compressed));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const shared = {
        full_name: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim(),
        date_of_birth: dob || null,
        gender: gender || null,
        department,
        designation: designation.trim() || null,
        employment_type: employmentType,
        joining_date: joiningDate,
        shift_start: shiftStart ? `${shiftStart}:00` : null,
        shift_end: shiftEnd ? `${shiftEnd}:00` : null,
        weekly_off: weeklyOff === "" ? null : Number(weeklyOff),
        ...(can(PERMISSIONS.staffSalaryView) && baseSalary !== ""
          ? { base_salary: baseSalary }
          : {}),
      };
      let staffId: string;
      if (existing) {
        const res = await api<StaffOut>(`/api/v1/staff/${existing.id}`, {
          method: "PATCH",
          body: { ...shared, status, access_role: accessRole },
        });
        staffId = res.id;
      } else {
        const res = await api<StaffOut>("/api/v1/staff", {
          method: "POST",
          body: { ...shared, access_role: accessRole, temp_password: tempPassword },
        });
        staffId = res.id;
      }
      if (photo) {
        // Photo failure must NOT read as a create failure — the staff row
        // already exists at this point. Warn and continue.
        try {
          const form = new FormData();
          form.append("file", photo, photo.name);
          await apiUpload(`/api/v1/staff/${staffId}/photo`, form, {
            hotelId: activeHotelId ?? undefined,
          });
        } catch {
          toast.warning(t("photoUploadFailed"));
        }
      }
      return staffId;
    },
    onSuccess: (staffId) => {
      toast.success(existing ? t("staffUpdatedToast") : t("staffCreatedToast"));
      queryClient.invalidateQueries({ queryKey: ["staff", activeHotelId] });
      onDone(staffId);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : tc("error")),
  });

  const canSubmit =
    fullName.trim().length >= 2 &&
    phone.trim().length >= 7 &&
    !!joiningDate &&
    (existing ? true : tempPassword.length >= 8);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        mutation.mutate();
      }}
    >
      {/* ── Personal Information ── */}
      <SectionPanel title={t("personalInfo")} icon={UserRound}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="row-span-2">
            <Label>{t("profilePhoto")}</Label>
            <label className="mt-1 flex h-[120px] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-input bg-white text-muted-foreground transition-colors hover:bg-muted/40">
              {photoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={photoPreview}
                  alt=""
                  className="size-20 rounded-full object-cover"
                />
              ) : (
                <>
                  <Camera className="size-6" aria-hidden />
                  <span className="text-label">{t("clickToUpload")}</span>
                </>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => void pickPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="sf-name">{t("fullName")} *</Label>
            <Input
              id="sf-name"
              required
              minLength={2}
              maxLength={200}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-email">{t("emailAddress")}</Label>
            <Input
              id="sf-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-phone">{t("mobileNumber")} *</Label>
            <Input
              id="sf-phone"
              type="tel"
              required
              minLength={7}
              maxLength={20}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-dob">{t("dateOfBirth")}</Label>
            <DatePicker
              id="sf-dob"
              value={dob}
              onChange={setDob}
              max={localToday()}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-gender">{t("gender")}</Label>
            <select
              id="sf-gender"
              className={selectCls}
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">—</option>
              <option value="Male">{t("male")}</option>
              <option value="Female">{t("female")}</option>
              <option value="Other">{t("genderOther")}</option>
            </select>
          </div>
        </div>
      </SectionPanel>

      {/* ── Employment Information ── */}
      <SectionPanel title={t("employmentInfo")} icon={IdCard}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t("staffId")}</Label>
            <p className="flex h-[42px] items-center rounded-md border border-input bg-muted px-2.5 text-sm text-muted-foreground">
              {existing?.staff_code ?? t("autoAssigned")}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-joining">{t("joiningDate")} *</Label>
            <DatePicker id="sf-joining" value={joiningDate} onChange={setJoiningDate} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-status">{t("currentStatus")}</Label>
            <select
              id="sf-status"
              className={selectCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as StaffOut["status"])}
              disabled={!existing}
            >
              <option value="active">{t("status_active")}</option>
              <option value="on_leave">{t("status_on_leave")}</option>
              <option value="inactive">{t("status_inactive")}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-dept">{t("department")} *</Label>
            <select
              id="sf-dept"
              className={selectCls}
              value={department}
              onChange={(e) => setDepartment(e.target.value as (typeof STAFF_DEPARTMENTS)[number])}
            >
              {STAFF_DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {t(`dept_${d}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-designation">{t("designation")}</Label>
            <Input
              id="sf-designation"
              maxLength={120}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-emp-type">{t("employmentType")}</Label>
            <select
              id="sf-emp-type"
              className={selectCls}
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as (typeof STAFF_EMPLOYMENT_TYPES)[number])}
            >
              {STAFF_EMPLOYMENT_TYPES.map((et) => (
                <option key={et} value={et}>
                  {t(`empType_${et}`)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-shift-start">{t("shiftStart")}</Label>
            <TimeInput id="sf-shift-start" value={shiftStart} onChange={setShiftStart} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-shift-end">{t("shiftEnd")}</Label>
            <TimeInput id="sf-shift-end" value={shiftEnd} onChange={setShiftEnd} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sf-weekly-off">{t("weeklyOff")}</Label>
            <select
              id="sf-weekly-off"
              className={selectCls}
              value={weeklyOff}
              onChange={(e) => setWeeklyOff(e.target.value)}
            >
              <option value="">—</option>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {t(`dow_${d}`)}
                </option>
              ))}
            </select>
          </div>
          {can(PERMISSIONS.staffSalaryView) && (
            <div className="space-y-1.5">
              <Label htmlFor="sf-salary">{t("baseSalary")}</Label>
              <Input
                id="sf-salary"
                type="number"
                min={0}
                step="1"
                className="tabular-nums"
                value={baseSalary}
                onChange={(e) => setBaseSalary(e.target.value)}
              />
            </div>
          )}
        </div>
      </SectionPanel>

      {/* ── Login Credentials & Access ── */}
      <SectionPanel title={t("loginAccess")} icon={KeyRound}>
        <div className="grid gap-4 lg:grid-cols-2">
          {!existing && (
            <div className="space-y-1.5">
              <Label htmlFor="sf-temp-pass">{t("tempPassword")} *</Label>
              <div className="flex gap-2">
                <PasswordInput
                  id="sf-temp-pass"
                  required
                  minLength={8}
                  value={tempPassword}
                  onChange={(e) => setTempPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-[42px] shrink-0"
                  onClick={() => setTempPassword(genTempPassword())}
                >
                  {t("generate")}
                </Button>
              </div>
              <p className="text-label text-muted-foreground">{t("tempPasswordHint")}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>{t("systemAccessRole")} *</Label>
            <div className="space-y-2">
              {STAFF_ACCESS_ROLES.map((role) => (
                <label
                  key={role}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors",
                    accessRole === role
                      ? "border-navy-900 bg-muted/40"
                      : "border-input hover:bg-muted/30",
                  )}
                >
                  <input
                    type="radio"
                    name="access_role"
                    value={role}
                    checked={accessRole === role}
                    onChange={() => setAccessRole(role)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-semibold">
                      {t(`role_${role}`)}
                    </span>
                    <span className="block text-label text-muted-foreground">
                      {t(`roleHint_${role}`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </SectionPanel>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-[42px] px-4"
          onClick={() => history.back()}
        >
          {tc("cancel")}
        </Button>
        <Button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="h-[42px] bg-gold-500 px-4 text-navy-900 hover:bg-gold-400"
        >
          {mutation.isPending ? tc("saving") : existing ? tc("save") : t("saveStaff")}
        </Button>
      </div>
    </form>
  );
}
