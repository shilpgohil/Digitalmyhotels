"use client";

import { useEffect, useState } from "react";
import { API_BASE, getAccessToken } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";
import { cn } from "@/lib/utils";

interface StaffAvatarProps {
  staffId: string;
  name: string;
  hasPhoto?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
  refreshTrigger?: number | string;
}

const SIZE_CLASSES = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-14 text-lg",
  xl: "size-20 text-2xl",
};

export function StaffAvatar({
  staffId,
  name,
  hasPhoto,
  size = "md",
  className,
  refreshTrigger,
}: StaffAvatarProps) {
  const { activeHotelId } = useAuth();
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPhoto || !staffId || !activeHotelId) {
      setSrc(null);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(`${API_BASE}/api/v1/staff/${staffId}/photo`, {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "X-Hotel-Id": activeHotelId ?? "",
          },
          credentials: "include",
        });
        if (!res.ok || cancelled) {
          if (!cancelled) setSrc(null);
          return;
        }
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [staffId, hasPhoto, activeHotelId, refreshTrigger]);

  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold",
        SIZE_CLASSES[size],
        className,
      )}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center bg-navy-900 text-white select-none">
          {initials || "?"}
        </span>
      )}
    </div>
  );
}
