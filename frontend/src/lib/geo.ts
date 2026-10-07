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
 * Great-circle distance between two points in metres using the Haversine formula.
 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const EARTH_RADIUS_M = 6_371_000.0;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlambda = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
  const clampedA = Math.max(0, Math.min(1, a));
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(clampedA)));
}

/**
 * Acquire a high-accuracy, fresh GPS fix.
 * Uses watchPosition with maximumAge: 0 to refine accuracy (ignoring initial coarse cell-tower estimates)
 * with an early-exit once good accuracy (<= 35m) is achieved, and a safe fallback if high-accuracy satellite lock fails.
 */
export function getPosition(timeoutMs = 12_000): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new GeoError("unsupported", "Geolocation is not supported on this device"));
      return;
    }

    let bestPos: GeoPosition | null = null;
    let watchId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (watchId !== null) {
        try {
          navigator.geolocation.clearWatch(watchId);
        } catch {
          /* ignore */
        }
        watchId = null;
      }
    };

    const done = (pos: GeoPosition) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(pos);
    };

    const fail = (err: GeoError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    // Overall timer: after at most 5 seconds (or timeoutMs), return the best fix so far or fallback
    const timer = setTimeout(() => {
      if (bestPos) {
        done(bestPos);
      } else {
        // Fallback: single attempt with standard accuracy in case high-accuracy GPS has no satellite lock
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            done({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy_m: Math.round(pos.coords.accuracy ?? 0),
            });
          },
          (err) => {
            if (err.code === err.PERMISSION_DENIED) {
              fail(new GeoError("denied", "Location permission denied"));
            } else if (err.code === err.TIMEOUT) {
              fail(new GeoError("timeout", "Timed out getting location"));
            } else {
              fail(new GeoError("unavailable", "Location unavailable"));
            }
          },
          { enableHighAccuracy: false, timeout: 5_000, maximumAge: 10_000 },
        );
      }
    }, Math.min(timeoutMs, 5_000));

    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const acc = Math.round(pos.coords.accuracy ?? 0);
          const current: GeoPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: acc,
          };

          if (!bestPos || acc < bestPos.accuracy_m) {
            bestPos = current;
          }

          // If we achieved strong GPS accuracy (<= 35 m), return immediately!
          if (acc <= 35) {
            clearTimeout(timer);
            done(current);
          }
        },
        (err) => {
          if (bestPos) {
            clearTimeout(timer);
            done(bestPos);
            return;
          }
          if (err.code === err.PERMISSION_DENIED) {
            clearTimeout(timer);
            fail(new GeoError("denied", "Location permission denied"));
          }
          // On other errors (e.g. POSITION_UNAVAILABLE), let timer try the fallback
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
    } catch {
      clearTimeout(timer);
      fail(new GeoError("unavailable", "Location unavailable"));
    }
  });
}
