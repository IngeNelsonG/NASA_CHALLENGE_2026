import type { BBox } from './types';

export const DEG = Math.PI / 180;
export const DAY_MS = 86_400_000;
export const EARTH_RADIUS_KM = 6371;

/**
 * Earth-fixed scene frame: +X = (0°N, 0°E), +Y = north pole, −Z = (0°N, 90°E).
 * Matches three's SphereGeometry UVs with an equirectangular texture.
 */
export function latLonToXYZ(lat: number, lon: number, r = 1): [number, number, number] {
  const cl = Math.cos(lat * DEG);
  return [r * cl * Math.cos(lon * DEG), r * Math.sin(lat * DEG), -r * cl * Math.sin(lon * DEG)];
}

export function xyzToLatLon(x: number, y: number, z: number): { lat: number; lon: number } {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(y / r) / DEG, lon: Math.atan2(-z, x) / DEG };
}

export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Sub-solar point for a UTC instant (low-precision solar ephemeris, ~0.01° — plenty for a terminator). */
export function subsolar(ms: number): { lat: number; lon: number } {
  const d = ms / DAY_MS + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / DEG;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / DEG;
  const gmst = (18.697374558 + 24.06570982441908 * d) * 15;
  return { lat: dec, lon: wrapLon(ra - gmst) };
}

// ---- dates (always UTC days) ----
export const dayIdx = (iso: string) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY_MS);
export const isoDay = (idx: number) => new Date(idx * DAY_MS).toISOString().slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);
export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInYear = (y: number) => (isLeap(y) ? 366 : 365);
export const yearStartIdx = (y: number) => Math.floor(Date.UTC(y, 0, 1) / DAY_MS);
/** 1-based day of year */
export const doyOf = (iso: string) => dayIdx(iso) - yearStartIdx(+iso.slice(0, 4)) + 1;

// ---- bbox ----
export const bboxCenter = (b: BBox) => ({ lat: (b[1] + b[3]) / 2, lon: (b[0] + b[2]) / 2 });
export const bboxSpan = (b: BBox) => Math.max(b[2] - b[0], b[3] - b[1]);
export const bboxId = (b: BBox) => `bbox:${b.map((v) => v.toFixed(2)).join(',')}`;
export const inBBox = (b: BBox, lat: number, lon: number) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

export const fmtLat = (lat: number) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}`;
export const fmtLon = (lon: number) => `${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
