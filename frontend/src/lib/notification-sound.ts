"use client";

/**
 * Notification Sound Manager for Hotel Partner Portal.
 *
 * Implements debounced, burst-protected audio notifications using the Slack
 * default notification sound ("knock_brush.mp3").
 *
 * Features:
 *  - Burst protection: 3-second cooldown window so rapid or simultaneous
 *    notifications (e.g. 3 or 5 arriving at once) sound only once.
 *  - Silent / Ringer preference stored in localStorage ("dmh:notification_sound_enabled").
 *  - Reactive hook `useNotificationSoundPreference` for instant UI updates.
 *  - Safe browser autoplay handling with graceful promise rejection catching.
 */

import { useCallback, useEffect, useState } from "react";

export const NOTIFICATION_SOUND_PATH = "/sounds/notification.mp3";
export const NOTIFICATION_SOUND_STORAGE_KEY = "dmh:notification_sound_enabled";
export const NOTIFICATION_SOUND_EVENT = "dmh:notification_sound_changed";
export const NOTIFICATION_SOUND_COOLDOWN_MS = 3000;

let lastPlayedTimestamp = 0;
let cachedAudio: HTMLAudioElement | null = null;

/** Returns or creates the cached HTMLAudioElement instance. */
function getAudioElement(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!cachedAudio) {
    try {
      cachedAudio = new Audio(NOTIFICATION_SOUND_PATH);
      cachedAudio.volume = 0.75;
      cachedAudio.preload = "auto";
    } catch {
      // Audio unsupported in this environment
      return null;
    }
  }
  return cachedAudio;
}

/** Check if the user has enabled notification sounds (default: true). */
export function isNotificationSoundEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const item = localStorage.getItem(NOTIFICATION_SOUND_STORAGE_KEY);
    return item === null ? true : item === "true";
  } catch {
    return true;
  }
}

/** Set notification sound preference and notify all listeners. */
export function setNotificationSoundEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(NOTIFICATION_SOUND_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore localStorage write failures
  }
  window.dispatchEvent(
    new CustomEvent(NOTIFICATION_SOUND_EVENT, { detail: { enabled } }),
  );
}

/**
 * Plays the notification sound once, adhering to:
 * 1. User ringer / silent preference.
 * 2. 3-second burst suppression window.
 *
 * @param force If true, bypasses cooldown (useful for previewing sound on ringer toggle).
 */
export function playNotificationSound(force = false): void {
  if (typeof window === "undefined") return;
  if (!isNotificationSoundEnabled()) return;

  const now = Date.now();
  if (!force && now - lastPlayedTimestamp < NOTIFICATION_SOUND_COOLDOWN_MS) {
    // Cooldown active: skip multiple rapid soundings
    return;
  }

  lastPlayedTimestamp = now;

  const audio = getAudioElement();
  if (!audio) return;

  try {
    audio.currentTime = 0;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Silently catch browser autoplay policy restrictions before user interaction
      });
    }
  } catch {
    // Silently ignore playback errors
  }
}

/**
 * React hook to read and toggle the notification sound preference reactively.
 */
export function useNotificationSoundPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => isNotificationSoundEnabled());

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === NOTIFICATION_SOUND_STORAGE_KEY) {
        setEnabled(e.newValue === null ? true : e.newValue === "true");
      }
    };

    const handleCustom = (e: Event) => {
      const custom = e as CustomEvent<{ enabled: boolean }>;
      if (custom.detail && typeof custom.detail.enabled === "boolean") {
        setEnabled(custom.detail.enabled);
      } else {
        setEnabled(isNotificationSoundEnabled());
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(NOTIFICATION_SOUND_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(NOTIFICATION_SOUND_EVENT, handleCustom);
    };
  }, []);

  const updatePreference = useCallback((nextVal: boolean) => {
    setNotificationSoundEnabled(nextVal);
    setEnabled(nextVal);
    if (nextVal) {
      // Play a quick chime as immediate auditory feedback when user un-mutes
      playNotificationSound(true);
    }
  }, []);

  return [enabled, updatePreference];
}
