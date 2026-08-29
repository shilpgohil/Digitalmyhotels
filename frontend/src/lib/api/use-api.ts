"use client";

import { useCallback } from "react";
import { apiFetch, type RequestOptions } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/auth-context";

/** apiFetch bound to the active hotel context. */
export function useApi() {
  const { activeHotelId } = useAuth();
  return useCallback(
    <T>(path: string, options: Omit<RequestOptions, "hotelId"> = {}) =>
      apiFetch<T>(path, { ...options, hotelId: activeHotelId ?? undefined }),
    [activeHotelId],
  );
}
