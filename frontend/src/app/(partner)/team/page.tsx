"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, MoreVertical, KeyRound, Ban, CheckCircle2 } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/feedback/status-badge";
import { useApi } from "@/lib/api/use-api";
import { useAuth } from "@/lib/auth/auth-context";
import { ApiError } from "@/lib/api/client";
import { fmtDateTime } from "@/lib/formatting";
import type { ListOut, TeamMemberOut } from "@/types/hotel";
import { RequirePermission } from "@/components/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";

const CREATABLE_ROLES = ["manager", "admin", "housekeeping"] as const;

function TeamContent() {
  const t = useTranslations("team");
  const tn = useTranslations("nav");
  const tc = useTranslations("common");
  const api = useApi();
  const queryClient = useQueryClient();
  const { activeHotelId } = useAuth();

  const team = useQuery({
    queryKey: ["team", activeHotelId],
    queryFn: () => api<ListOut<TeamMemberOut>>("/api/v1/team?limit=100"),
    enabled: !!activeHotelId,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["team", activeHotelId] });

  const statusMutation = useMutation({
    mutationFn: ({ membershipId, enabled }: { membershipId: string; enabled: boolean }) =>
      api<TeamMemberOut>(`/api/v1/team/${membershipId}/status`, {
        method: "PUT",
        body: { enabled },
      }),
    onSuccess: () => {
      toast.success(t("memberUpdated"));
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  const [resetTarget, setResetTarget] = useState<TeamMemberOut | null>(null);

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("settings")} />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex justify-end">
          <CreateMemberDialog onCreated={invalidate} />
        </div>
        <div className="rounded-lg border bg-card">
          {team.isLoading && (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {team.isError && (
            <div className="p-8 text-center text-sm text-danger">
              {tc("error")}{" "}
              <button className="underline" onClick={() => team.refetch()}>
                {tc("retry")}
              </button>
            </div>
          )}
          {team.data && team.data.items.length === 0 && (
            <p className="p-10 text-center text-sm text-muted-foreground">{t("noMembers")}</p>
          )}
          {team.data && team.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{t("name")}</TableHead>
                  <TableHead className="text-white">{t("email")}</TableHead>
                  <TableHead className="text-white">{t("role")}</TableHead>
                  <TableHead className="text-white">{t("status")}</TableHead>
                  <TableHead className="text-white">{t("lastLogin")}</TableHead>
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.data.items.map((member) => (
                  <TableRow key={member.membership_id}>
                    <TableCell className="font-medium">{member.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>{member.role_name}</TableCell>
                    <TableCell>
                      <StatusBadge tone={member.is_active ? "success" : "danger"}>
                        {member.is_active ? t("active") : t("disabled")}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {member.last_login_at
                        ? fmtDateTime(member.last_login_at)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {member.role_code !== "owner" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="inline-flex size-8 items-center justify-center rounded-md hover:bg-muted"
                            aria-label={tc("actions")}
                          >
                            <MoreVertical className="size-4" aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setResetTarget(member)}>
                              <KeyRound className="size-4" aria-hidden />
                              {t("resetPassword")}
                            </DropdownMenuItem>
                            {member.is_active ? (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  statusMutation.mutate({
                                    membershipId: member.membership_id,
                                    enabled: false,
                                  })
                                }
                              >
                                <Ban className="size-4" aria-hidden />
                                {t("disable")}
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() =>
                                  statusMutation.mutate({
                                    membershipId: member.membership_id,
                                    enabled: true,
                                  })
                                }
                              >
                                <CheckCircle2 className="size-4" aria-hidden />
                                {t("enable")}
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <ResetPasswordDialog
          member={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={invalidate}
        />
      </main>
    </>
  );
}

function CreateMemberDialog({ onCreated }: { onCreated: () => void }) {
  const t = useTranslations("team");
  const tc = useTranslations("common");
  const api = useApi();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api<TeamMemberOut>("/api/v1/team", {
        method: "POST",
        body: {
          full_name: String(form.get("full_name")).trim(),
          email: String(form.get("email")).trim(),
          phone: String(form.get("phone") || "").trim() || null,
          role_code: String(form.get("role_code")),
          password: String(form.get("password")),
        },
      }),
    onSuccess: () => {
      toast.success(t("memberCreated"));
      setOpen(false);
      setError(null);
      onCreated();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : tc("error")),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80">
        <Plus className="size-4" aria-hidden />
        {t("addMember")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addMember")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="tm-name">{t("name")}</Label>
              <Input id="tm-name" name="full_name" required minLength={2} maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-email">{t("email")}</Label>
              <Input id="tm-email" name="email" type="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-phone">{t("phone")}</Label>
              <Input id="tm-phone" name="phone" maxLength={32} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-role">{t("role")}</Label>
              <select
                id="tm-role"
                name="role_code"
                required
                className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
              >
                {CREATABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {t(`role_${role}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-password">{t("newPassword")}</Label>
              <Input id="tm-password" name="password" type="password" required minLength={8} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("temporaryPasswordHint")}</p>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({
  member,
  onClose,
  onDone,
}: {
  member: TeamMemberOut | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("team");
  const tc = useTranslations("common");
  const api = useApi();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({ membershipId, password }: { membershipId: string; password: string }) =>
      api(`/api/v1/team/${membershipId}/reset-password`, {
        method: "POST",
        body: { new_password: password },
      }),
    onSuccess: () => {
      toast.success(t("passwordWasReset"));
      setError(null);
      onClose();
      onDone();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : tc("error")),
  });

  return (
    <Dialog open={member !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("resetPassword")} — {member?.full_name}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!member) return;
            const form = new FormData(e.currentTarget);
            mutation.mutate({
              membershipId: member.membership_id,
              password: String(form.get("password")),
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="rp-password">{t("newPassword")}</Label>
            <Input id="rp-password" name="password" type="password" required minLength={8} />
            <p className="text-xs text-muted-foreground">{t("temporaryPasswordHint")}</p>
          </div>
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-sm hover:bg-muted">
              {tc("cancel")}
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? tc("saving") : tc("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function TeamPage() {
  return (
    <RequirePermission permission={PERMISSIONS.hotelManageTeam}>
      <TeamContent />
    </RequirePermission>
  );
}
