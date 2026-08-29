"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { FullPageSpinner } from "@/components/feedback/full-page-spinner";

export default function RootPage() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
    } else if (status === "authenticated") {
      router.replace(user?.is_super_admin ? "/admin" : "/dashboard");
    }
  }, [status, user, router]);

  return <FullPageSpinner />;
}
