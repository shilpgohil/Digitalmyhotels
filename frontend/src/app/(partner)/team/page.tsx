"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, MoreVertical, KeyRound, Ban, CheckCircle2, Eye, EyeOff, Pencil, Users } from "lucide-react";
import { PartnerHeader } from "@/components/layout/partner-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { PaginationFooter, paginate } from "@/components/ui/pagination-footer";
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
  const [editTarget, setEditTarget] = useState<TeamMemberOut | null>(null);
  const [page, setPage] = useState(1);

  // Pending staff password-reset requests (hierarchical flow, item 34).
  const passwordRequests = useQuery({
    queryKey: ["team-password-requests", activeHotelId],
    queryFn: () =>
      api<{ id: string; user_id: string; full_name: string; email: string; requested_at: string }[]>(
        "/api/v1/team/password-requests",
      ),
    enabled: !!activeHotelId,
    refetchInterval: 60_000,
  });

  const dismissRequest = useMutation({
    mutationFn: (requestId: string) =>
      api(`/api/v1/team/password-requests/${requestId}/dismiss`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-password-requests", activeHotelId] });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : tc("error")),
  });

  return (
    <>
      <PartnerHeader title={t("title")} subtitle={tn("settings")} />
      <main className="flex-1 overflow-y-auto p-4 sm:p-6">
        {/* Pending reset requests — staff asked for help signing in. */}
        {(passwordRequests.data?.length ?? 0) > 0 && (
          <div className="mb-4 rounded-xl border border-warning/30 bg-warning-bg p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <KeyRound className="size-4" aria-hidden />
              {t("pendingResetRequests", { count: passwordRequests.data!.length })}
            </p>
            <ul className="mt-2 space-y-2">
              {passwordRequests.data!.map((req) => {
                const member = team.data?.items.find((m) => m.user_id === req.user_id);
                return (
                  <li key={req.id} className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium">{req.full_name}</span>
                    <span className="text-muted-foreground">{req.email}</span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDateTime(req.requested_at)}
                    </span>
                    <span className="ml-auto flex gap-2">
                      {member && (
                        <Button size="sm" onClick={() => setResetTarget(member)}>
                          {t("resetPassword")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dismissRequest.isPending}
                        onClick={() => dismissRequest.mutate(req.id)}
                      >
                        {t("dismissRequest")}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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
            <EmptyState icon={Users} title={t("noMembers")} subtitle="Add team members to manage access and roles." />
          )}
          {team.data && team.data.items.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow className="bg-navy-900 hover:bg-navy-900">
                  <TableHead className="text-white">{t("name")}</TableHead>
                  <TableHead className="text-white">{t("phone")}</TableHead>
                  <TableHead className="text-white">{t("email")}</TableHead>
                  <TableHead className="text-white">{t("role")}</TableHead>
                  <TableHead className="text-white">{t("status")}</TableHead>
                  <TableHead className="text-white">{t("lastLogin")}</TableHead>
                  <TableHead className="text-right text-white">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginate(team.data.items, page, 10).map((member) => (
                  <TableRow key={member.membership_id}>
                    <TableCell className="font-medium">{member.full_name}</TableCell>
                    <TableCell className="text-muted-foreground">{member.phone || "—"}</TableCell>
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
                            <DropdownMenuItem onClick={() => setEditTarget(member)}>
                              <Pencil className="size-4" aria-hidden />
                              {t("editProfile")}
                            </DropdownMenuItem>
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
          {team.data && team.data.items.length > 0 && (
            <PaginationFooter
              page={page}
              total={team.data.items.length}
              pageSize={10}
              onPageChange={setPage}
            />
          )}
        </div>
        <ResetPasswordDialog
          member={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={() => {
            invalidate();
            // A completed reset resolves the pending request server-side.
            queryClient.invalidateQueries({
              queryKey: ["team-password-requests", activeHotelId],
            });
          }}
        />
        <EditMemberDialog
          member={editTarget}
          onClose={() => setEditTarget(null)}
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
  const [showPassword, setShowPassword] = useState(false);

  const mutation = useMutation({
    mutationFn: (form: FormData) =>
      api<TeamMemberOut>("/api/v1/team", {
        method: "POST",
        body: {
          full_name: String(form.get("full_name")).trim(),
          email: String(form.get("email") || "").trim() || null,
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
              <Label htmlFor="tm-phone">{t("phone")}</Label>
              <Input id="tm-phone" name="phone" type="tel" required maxLength={32} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tm-email">{t("email")}</Label>
              <Input id="tm-email" name="email" type="email" placeholder={t("emailOptional")} />
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
              <div className="relative">
                <Input
                  id="tm-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  className="pr-9"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
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
            <PasswordInput id="rp-password" name="password" required minLength={8} />
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

/**
 * Edit a team member's profile (name / phone / role) via the existing
 * PATCH /team/{membership_id} route (client 9-08 item 32).
 */
function EditMemberDialog({
  member,
  onClose,
  onDone,
}: {
  readonly member: TeamMemberOut | null;
  readonly onClose: () => void;
  readonly onDone: () => void;
}) {
  const t = useTranslations("team");
  const tc = useTranslations("common");
  const api = useApi();
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: ({
      membershipId,
      body,
    }: {
      membershipId: string;
      body: Record<string, string>;
    }) =>
      api<TeamMemberOut>(`/api/v1/team/${membershipId}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: () => {
      toast.success(t("memberUpdated"));
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
            {t("editProfile")} — {member?.full_name}
          </DialogTitle>
        </DialogHeader>
        <form
          key={member?.membership_id ?? "none"}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!member) return;
            const form = new FormData(e.currentTarget);
            const body: Record<string, string> = {};
            const name = String(form.get("full_name") || "").trim();
            const phone = String(form.get("phone") || "").trim();
            const role = String(form.get("role_code") || "");
            if (name && name !== member.full_name) body.full_name = name;
            if (phone !== (member.phone ?? "")) body.phone = phone;
            if (role && role !== member.role_code) body.role_code = role;
            if (Object.keys(body).length === 0) {
              onClose();
              return;
            }
            mutation.mutate({ membershipId: member.membership_id, body });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="em-name">{t("name")}</Label>
            <Input
              id="em-name"
              name="full_name"
              defaultValue={member?.full_name ?? ""}
              required
              minLength={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-phone">{t("phone")}</Label>
            <Input
              id="em-phone"
              name="phone"
              defaultValue={member?.phone ?? ""}
              inputMode="tel"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="em-role">{t("role")}</Label>
            <select
              id="em-role"
              name="role_code"
              defaultValue={member?.role_code ?? ""}
              className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            >
              {CREATABLE_ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`role_${r}`)}
                </option>
              ))}
            </select>
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
