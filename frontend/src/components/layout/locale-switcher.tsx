"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    const next = locale === "en" ? "hi" : "en";
    // Locale cookie read by src/i18n/request.ts on the server.
    document.cookie = `dmh_locale=${next};path=/;max-age=31536000;samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      disabled={pending}
      aria-label={locale === "en" ? "हिंदी में बदलें" : "Switch to English"}
    >
      {locale === "en" ? "हिंदी" : "English"}
    </Button>
  );
}
