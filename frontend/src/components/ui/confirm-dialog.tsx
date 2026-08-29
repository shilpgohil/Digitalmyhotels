"use client";

/**
 * ConfirmDialog — a controlled, keyboard-accessible replacement for
 * window.prompt() / window.confirm() used throughout the partner portal.
 *
 * Usage:
 *   const { open, show, hide, value } = useConfirmDialog();
 *   <ConfirmDialog
 *     open={open}
 *     title="Cancel booking"
 *     message="Please enter the reason for cancellation."
 *     requireText           // requires non-empty text input
 *     confirmLabel="Cancel booking"
 *     confirmVariant="destructive"
 *     onConfirm={(reason) => cancelMutation.mutate({ id, reason })}
 *     onCancel={hide}
 *   />
 *   <Button onClick={() => show()}>Cancel</Button>
 */

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  /** If true, shows a text input and requires non-empty content before confirming. */
  requireText?: boolean;
  textLabel?: string;
  textPlaceholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline";
  onConfirm: (value: string) => void;
  onCancel: () => void;
  isPending?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  requireText = false,
  textLabel,
  textPlaceholder,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "default",
  onConfirm,
  onCancel,
  isPending = false,
}: ConfirmDialogProps) {
  const [text, setText] = useState("");

  const handleConfirm = () => {
    onConfirm(text);
    setText("");
  };

  const handleCancel = () => {
    setText("");
    onCancel();
  };

  const canConfirm = !requireText || text.trim().length >= 3;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {message && (
          <p className="text-sm text-muted-foreground">{message}</p>
        )}
        {requireText && (
          <div className="space-y-1.5">
            {textLabel && <Label>{textLabel}</Label>}
            <Input
              placeholder={textPlaceholder ?? "Enter reason…"}
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canConfirm) handleConfirm();
                if (e.key === "Escape") handleCancel();
              }}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={!canConfirm || isPending}
          >
            {isPending ? "…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Hook for managing a single ConfirmDialog's open/closed state. */
export function useConfirmDialog() {
  const [open, setOpen] = useState(false);
  return {
    open,
    show: () => setOpen(true),
    hide: () => setOpen(false),
  };
}
