"use client";

import { useState } from "react";
import { MessageSquare, Phone, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normalizeWhatsAppPhone, openWhatsAppToCustomer } from "@/lib/whatsapp-share";

interface WhatsAppPhoneDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly initialPhone?: string | null;
  readonly guestName?: string | null;
  readonly documentTitle?: string;
  readonly message: string;
}

export function WhatsAppPhoneDialog({
  open,
  onClose,
  initialPhone,
  guestName,
  documentTitle = "Document",
  message,
}: WhatsAppPhoneDialogProps) {
  const [phone, setPhone] = useState(initialPhone || "");
  const [error, setError] = useState<string | null>(null);

  const handleSend = () => {
    const clean = normalizeWhatsAppPhone(phone);
    if (!clean || clean.length < 10) {
      setError("Please enter a valid 10-digit mobile number");
      return;
    }
    setError(null);
    openWhatsAppToCustomer(clean, message);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-emerald-600">
            <MessageSquare className="size-5 shrink-0" />
            <DialogTitle className="text-lg font-bold text-slate-900">
              Send {documentTitle} on WhatsApp
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-slate-500">
            Enter the customer&apos;s WhatsApp mobile number. WhatsApp will open directly to their conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {guestName && (
            <div className="rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
              Guest: <span className="font-semibold text-slate-800">{guestName}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="wa-phone-input" className="text-xs font-semibold text-slate-700">
              WhatsApp Mobile Number *
            </Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <Input
                id="wa-phone-input"
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="+91 98765 43210"
                className="pl-9 h-11 text-base font-mono"
                autoFocus
              />
            </div>
            {error && <p className="text-xs font-medium text-rose-500">{error}</p>}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
          >
            <Send className="size-4" />
            Open WhatsApp
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
