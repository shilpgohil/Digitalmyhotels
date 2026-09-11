/** Browser geolocation helpers for the staff-attendance geofence. */

export interface GeoPosition {
  lat: number;
  lng: number;
  accuracy_m: number;
}

export class GeoError extends Error {
  readonly kind: "denied" | "unavailable" | "timeout" | "unsupported";

  constructor(kind: GeoError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Promise wrapper around navigator.geolocation with high accuracy.
 * The SERVER makes the actual geofence decision — this only collects the fix.
 */
export function getPosition(timeoutMs = 12_000): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GeoError("unsupported", "Geolocation is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy ?? 0),
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new GeoError("denied", "Location permission denied"));
        } else if (err.code === err.TIMEOUT) {
          reject(new GeoError("timeout", "Timed out getting location"));
        } else {
          reject(new GeoError("unavailable", "Location unavailable"));
        }
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15_000 },
    );
  });
}
