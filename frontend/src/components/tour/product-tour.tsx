"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { driver, type Driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { useAuth } from "@/lib/auth/auth-context";
import { PERMISSIONS } from "@/lib/permissions";
import { useSubscription } from "@/components/subscription/subscription-gate";

const TOUR_DONE_KEY = "dmh.tourDone.v1";

/**
 * Guided product tour for the partner portal.
 *
 * Auto-starts once per browser after the first login (persisted in
 * localStorage) and can be replayed any time from the header help button.
 * Steps are permission-aware: sections the user cannot access are skipped.
 */
export function useProductTour() {
  const t = useTranslations("tour");
  const { can, user, accessMode, memberships, activeHotelId } = useAuth();
  const sub = useSubscription();
  const router = useRouter();
  const pathname = usePathname();
  const driverRef = useRef<Driver | null>(null);

  const buildSteps = useCallback((): DriveStep[] => {
    const steps: DriveStep[] = [
      {
        popover: {
          title: t("welcomeTitle"),
          description: t("welcomeBody"),
        },
      },
      {
        element: "[data-tour='sidebar']",
        popover: {
          title: t("sidebarTitle"),
          description: t("sidebarBody"),
          side: "right",
        },
      },
      {
        element: "[data-tour='status-cards']",
        popover: {
          title: t("statusCardsTitle"),
          description: t("statusCardsBody"),
          side: "bottom",
        },
      },
    ];

    if (can(PERMISSIONS.guestsView)) {
      steps.push({
        element: "[data-tour='inhouse']",
        popover: {
          title: t("inhouseTitle"),
          description: t("inhouseBody"),
          side: "top",
        },
      });
    }
    steps.push({
      element: "[data-tour='quick-actions']",
      popover: {
        title: t("quickActionsTitle"),
        description: t("quickActionsBody"),
        side: "left",
      },
    });
    if (can(PERMISSIONS.checkin)) {
      steps.push({
        element: "[data-tour='nav-checkin']",
        popover: {
          title: t("checkinTitle"),
          description: t("checkinBody"),
          side: "right",
        },
      });
    }
    if (can(PERMISSIONS.roomsView)) {
      steps.push({
        element: "[data-tour='nav-rooms']",
        popover: {
          title: t("roomsTitle"),
          description: t("roomsBody"),
          side: "right",
        },
      });
    }
    if (can(PERMISSIONS.paymentsView)) {
      steps.push({
        element: "[data-tour='nav-payments']",
        popover: {
          title: t("paymentsTitle"),
          description: t("paymentsBody"),
          side: "right",
        },
      });
    }
    if (can(PERMISSIONS.expensesView) && accessMode !== "checkin_only") {
      steps.push({
        element: "[data-tour='nav-expenses']",
        popover: {
          title: t("expensesTitle"),
          description: t("expensesBody"),
          side: "right",
        },
      });
    }
    if (can(PERMISSIONS.reportsView)) {
      steps.push({
        element: "[data-tour='nav-reports']",
        popover: {
          title: t("reportsTitle"),
          description: t("reportsBody"),
          side: "right",
        },
      });
    }
    if (can(PERMISSIONS.notificationsView)) {
      steps.push({
        element: "[data-tour='bell']",
        popover: {
          title: t("bellTitle"),
          description: t("bellBody"),
          side: "bottom",
        },
      });
    }
    steps.push({
      element: "[data-tour='locale']",
      popover: {
        title: t("localeTitle"),
        description: t("localeBody"),
        side: "bottom",
      },
    });
    if (can(PERMISSIONS.hotelManageSettings)) {
      steps.push({
        element: "[data-tour='upgrade-plan']",
        popover: {
          title: t("planTitle"),
          description: t("planBody"),
          side: "top",
        },
      });
    }
    steps.push({
      popover: {
        title: t("doneTitle"),
        description: t("doneBody"),
      },
    });
    return steps;
  }, [can, t, accessMode]);

  const launchTour = useCallback(() => {
    driverRef.current?.destroy();

    // Abort if user must reset password, hotel is suspended, or plan is blocked
    if (!user || user.must_reset_password) return;
    const activeMem =
      memberships.find((m) => m.hotel_id === activeHotelId) ?? memberships[0];
    if (activeMem?.hotel_status === "suspended") return;
    if (sub.data?.status === "expired" || sub.data?.status === "suspended") return;

    // Abort if any modal dialog or overlay is currently active
    if (typeof document !== "undefined") {
      const activeModal = document.querySelector(
        "[role='dialog'], [data-state='open']",
      );
      if (activeModal) return;
    }

    // Filter steps to those whose target element exists on the current page.
    const allSteps = buildSteps();
    const filtered = allSteps.filter((step) => {
      if (!step.element) return true; // welcome/done popovers always include
      const el = document.querySelector(step.element as string);
      return !!el;
    });

    // If almost nothing is visible (only welcome + done), go to dashboard first.
    const anchoredSteps = filtered.filter((s) => !!s.element);
    if (anchoredSteps.length < 2 && pathname !== "/dashboard") {
      router.push("/dashboard");
      setTimeout(() => launchTour(), 700);
      return;
    }
    if (filtered.length === 0) return;

    const instance = driver({
      showProgress: true,
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 10,
      nextBtnText: t("next"),
      prevBtnText: t("back"),
      doneBtnText: t("finish"),
      progressText: "{{current}} / {{total}}",
      steps: filtered,
      onDestroyed: () => {
        localStorage.setItem(TOUR_DONE_KEY, "1");
      },
    });
    driverRef.current = instance;
    instance.drive();
  }, [buildSteps, t, pathname, router, user, memberships, activeHotelId, sub.data?.status]);

  // start() is an alias for launchTour
  const start = launchTour;

  // Auto-start once after first login on the dashboard with safety guards
  useEffect(() => {
    if (!user || pathname !== "/dashboard") return;
    if (user.must_reset_password) return;
    const activeMem =
      memberships.find((m) => m.hotel_id === activeHotelId) ?? memberships[0];
    if (activeMem?.hotel_status === "suspended") return;
    if (sub.isLoading || sub.data?.status === "expired" || sub.data?.status === "suspended") return;
    if (localStorage.getItem(TOUR_DONE_KEY)) return;

    const timer = setTimeout(() => {
      // Ensure dashboard data and anchor elements have settled
      const sidebarEl = document.querySelector("[data-tour='sidebar']");
      const cardsEl = document.querySelector("[data-tour='status-cards']");
      const hasModal = document.querySelector("[role='dialog'], [data-state='open']");
      if (!sidebarEl && !cardsEl) return;
      if (hasModal) return;
      launchTour();
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    user,
    pathname,
    memberships,
    activeHotelId,
    sub.isLoading,
    sub.data?.status,
    launchTour,
  ]);

  useEffect(() => () => driverRef.current?.destroy(), []);

  // Both helpers are the same now: the tour decides whether to navigate.
  return { startTour: start, startTourInPlace: start };
}
