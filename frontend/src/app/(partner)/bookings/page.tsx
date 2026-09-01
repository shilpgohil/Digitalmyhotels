"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The standalone Bookings section was replaced by Advance Bookings. */
export default function BookingsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/advance-bookings");
  }, [router]);
  return null;
}
