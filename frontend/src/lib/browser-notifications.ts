"use client";

/**
 * Browser & System Notifications Manager for Hotel Partner Portal.
 *
 * Implements HTML5 Web Notifications and Service Worker Notifications so alerts
 * appear in desktop notification centers (Windows Action Center, macOS Notification Center)
 * and mobile notification panels when browser notifications are permitted.
 *
 * Features:
 * 1. Checks browser support and current permission status (granted, default, denied).
 * 2. Prompts user for browser permission upon interaction.
 * 3. Registers service worker (/sw.js) for reliable background notification handling.
 * 4. Burst and batch protection: groups multiple incoming alerts into a single clean OS notification.
 * 5. Persistent user preference stored in localStorage ("dmh:browser_notifications_enabled").
 * 6. Reactive hook `useBrowserNotifications` for settings and bell components.
 */

import { useCallback, useEffect, useState } from "react";

export const BROWSER_NOTIFICATIONS_STORAGE_KEY = "dmh:browser_notifications_enabled";
export const BROWSER_NOTIFICATIONS_EVENT = "dmh:browser_notifications_changed";

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Checks if the browser supports HTML5 Web Notifications.
 */
export function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Retrieves the current browser notification permission status.
 */
export function getBrowserNotificationPermission(): NotificationPermission | "unsupported" {
  if (!isBrowserNotificationSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Checks if the user has enabled browser notifications in portal preferences.
 */
export function isBrowserNotificationEnabled(): boolean {
  if (typeof window === "undefined") return false;
  if (!isBrowserNotificationSupported() || Notification.permission !== "granted") {
    return false;
  }
  try {
    const item = localStorage.getItem(BROWSER_NOTIFICATIONS_STORAGE_KEY);
    return item === null ? true : item === "true";
  } catch {
    return true;
  }
}

/**
 * Updates the user preference for browser notifications.
 */
export function setBrowserNotificationEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(BROWSER_NOTIFICATIONS_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore localStorage write failures
  }
  window.dispatchEvent(
    new CustomEvent(BROWSER_NOTIFICATIONS_EVENT, { detail: { enabled } }),
  );
}

/**
 * Registers the background service worker for system notifications if supported.
 */
export function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return Promise.resolve(null);
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg)
      .catch((err) => {
        console.warn("Service worker registration for notifications skipped:", err);
        return null;
      });
  }
  return swRegistrationPromise;
}

/**
 * Requests permission from the browser to display system notifications.
 */
export async function requestBrowserNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!isBrowserNotificationSupported()) {
    return "unsupported";
  }

  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      setBrowserNotificationEnabled(true);
      // Pre-warm the service worker
      getServiceWorkerRegistration().catch(() => {});
    } else {
      setBrowserNotificationEnabled(false);
    }
    return result;
  } catch {
    // Fallback for older Safari callback syntax
    return new Promise((resolve) => {
      try {
        Notification.requestPermission((p) => {
          if (p === "granted") {
            setBrowserNotificationEnabled(true);
            getServiceWorkerRegistration().catch(() => {});
          } else {
            setBrowserNotificationEnabled(false);
          }
          resolve(p);
        });
      } catch {
        resolve("denied");
      }
    });
  }
}

export interface SystemNotificationOptions {
  body?: string;
  tag?: string;
  deepLink?: string | null;
  icon?: string;
}

/**
 * Displays a system notification in the OS notification panel.
 */
export async function showSystemNotification(
  title: string,
  options?: SystemNotificationOptions,
): Promise<boolean> {
  if (!isBrowserNotificationSupported()) return false;
  if (Notification.permission !== "granted") return false;
  if (!isBrowserNotificationEnabled()) return false;

  const iconUrl = options?.icon || "/dmh-icon.png";
  const notificationOptions: NotificationOptions = {
    body: options?.body || "",
    icon: iconUrl,
    badge: iconUrl,
    tag: options?.tag || "dmh-alert",
    data: {
      deepLink: options?.deepLink || "/",
    },
  };

  // Attempt using the active service worker first (best for mobile and background tabs)
  try {
    const reg = await getServiceWorkerRegistration();
    if (reg && "showNotification" in reg) {
      await reg.showNotification(title, notificationOptions);
      return true;
    }
  } catch {
    // Fallback to standard window Notification
  }

  // Fallback to standard DOM Notification
  try {
    const n = new Notification(title, notificationOptions);
    n.onclick = (event) => {
      event.preventDefault();
      window.focus();
      if (options?.deepLink) {
        window.location.href = options.deepLink;
      }
      n.close();
    };
    return true;
  } catch (err) {
    console.warn("Failed to show system notification:", err);
    return false;
  }
}

/**
 * Groups and displays incoming unread notifications with burst protection.
 * If 1 arrives, displays detailed notification with deep link.
 * If multiple arrive, groups them to avoid spamming the OS notification tray.
 */
export async function showBatchSystemNotifications(
  items: Array<{
    id: string;
    title: string;
    body?: string | null;
    message?: string | null;
    deep_link?: string | null;
  }>,
): Promise<void> {
  if (!items.length) return;
  if (!isBrowserNotificationSupported()) return;
  if (Notification.permission !== "granted" || !isBrowserNotificationEnabled()) return;

  const getContent = (item: { body?: string | null; message?: string | null }) =>
    item.body || item.message || "";

  if (items.length === 1) {
    const item = items[0];
    await showSystemNotification(item.title, {
      body: getContent(item),
      tag: `dmh-notif-${item.id}`,
      deepLink: item.deep_link,
    });
    return;
  }

  // Grouped summary for multiple notifications arriving at once
  const first = items[0];
  const count = items.length;
  await showSystemNotification(`DigitalMyHotels: ${count} New Alerts`, {
    body: `${first.title}: ${getContent(first)} (+${count - 1} more)`,
    tag: `dmh-batch-${Date.now()}`,
    deepLink: "/notifications",
  });
}

/**
 * Reactive hook for managing browser notification permissions and settings.
 */
export function useBrowserNotifications() {
  const [isSupported, setIsSupported] = useState<boolean>(() =>
    isBrowserNotificationSupported(),
  );
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    getBrowserNotificationPermission(),
  );
  const [isEnabled, setIsEnabled] = useState<boolean>(() =>
    isBrowserNotificationEnabled(),
  );

  const refreshState = useCallback(() => {
    const supp = isBrowserNotificationSupported();
    setIsSupported(supp);
    setPermission(getBrowserNotificationPermission());
    setIsEnabled(isBrowserNotificationEnabled());
  }, []);

  useEffect(() => {
    refreshState();

    const handleCustom = (e: Event) => {
      const custom = e as CustomEvent<{ enabled: boolean }>;
      if (custom.detail && typeof custom.detail.enabled === "boolean") {
        setIsEnabled(custom.detail.enabled);
      } else {
        setIsEnabled(isBrowserNotificationEnabled());
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === BROWSER_NOTIFICATIONS_STORAGE_KEY) {
        setIsEnabled(isBrowserNotificationEnabled());
      }
    };

    window.addEventListener(BROWSER_NOTIFICATIONS_EVENT, handleCustom);
    window.addEventListener("storage", handleStorage);

    // Warm up service worker if already granted
    if (Notification.permission === "granted") {
      getServiceWorkerRegistration().catch(() => {});
    }

    return () => {
      window.removeEventListener(BROWSER_NOTIFICATIONS_EVENT, handleCustom);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshState]);

  const requestPermission = useCallback(async () => {
    const result = await requestBrowserNotificationPermission();
    refreshState();
    return result;
  }, [refreshState]);

  const setEnabled = useCallback((enabled: boolean) => {
    setBrowserNotificationEnabled(enabled);
    setIsEnabled(enabled);
  }, []);

  const sendTestNotification = useCallback(async () => {
    return showSystemNotification("DigitalMyHotels Alert", {
      body: "Test notification: Desktop and mobile OS alerts are active and working.",
      deepLink: "/notifications",
      tag: "dmh-test-notification",
    });
  }, []);

  return {
    isSupported,
    permission,
    isEnabled,
    requestPermission,
    setEnabled,
    sendTestNotification,
  };
}
