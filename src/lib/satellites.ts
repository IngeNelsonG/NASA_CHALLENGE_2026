import { eciToEcf, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';
import { EARTH_RADIUS_KM, xyzToLatLon } from './geo';
import type { TLE } from './types';

export type SatMeta = {
  short: string;
  instrument: 'MODIS' | 'VIIRS';
  resolution: '1 km' | '375 m';
  /** nominal local equator-crossing time */
  overpass: string;
  node: 'asc' | 'desc';
  since: number;
  primary: boolean;
};

// Nominal mission facts. Terra and Aqua have been drifting from these crossing times since ~2020–2022.
export const SAT_META: Record<number, SatMeta> = {
  25994: { short: 'Terra', instrument: 'MODIS', resolution: '1 km', overpass: '10:30', node: 'desc', since: 2000, primary: false },
  27424: { short: 'Aqua', instrument: 'MODIS', resolution: '1 km', overpass: '13:30', node: 'asc', since: 2002, primary: true },
  37849: { short: 'Suomi NPP', instrument: 'VIIRS', resolution: '375 m', overpass: '13:30', node: 'asc', since: 2012, primary: true },
  43013: { short: 'NOAA-20', instrument: 'VIIRS', resolution: '375 m', overpass: '13:30', node: 'asc', since: 2018, primary: false },
  54234: { short: 'NOAA-21', instrument: 'VIIRS', resolution: '375 m', overpass: '13:30', node: 'asc', since: 2023, primary: false },
};

export type Sat = { norad: number; name: string; meta: SatMeta; rec: SatRec; periodMin: number };

export function buildSats(tles: TLE[]): Sat[] {
  const out: Sat[] = [];
  for (const t of tles) {
    const rec = twoline2satrec(t.line1, t.line2);
    if (rec.error) continue;
    const meta: SatMeta = SAT_META[t.norad] ?? {
      short: t.name,
      instrument: t.instrument,
      resolution: t.instrument === 'MODIS' ? '1 km' : '375 m',
      overpass: '—',
      node: 'asc',
      since: 0,
      primary: false,
    };
    out.push({ norad: t.norad, name: meta.short, meta, rec, periodMin: (2 * Math.PI) / rec.no });
  }
  return out;
}

const scratch = new Date();
/**
 * Earth-fixed scene position (unit = Earth radius) at a UTC instant, written into `out` at `offset`.
 * Returns false when SGP4 fails for that instant.
 */
export function satScenePos(rec: SatRec, ms: number, out: Float32Array | number[], offset = 0): boolean {
  scratch.setTime(ms);
  const pv = propagate(rec, scratch);
  const p = pv.position;
  if (!p || typeof p !== 'object') return false;
  const ecf = eciToEcf(p, gstime(scratch));
  // ECEF (x: 0°E, y: 90°E, z: north) → scene (x, z, −y)
  out[offset] = ecf.x / EARTH_RADIUS_KM;
  out[offset + 1] = ecf.z / EARTH_RADIUS_KM;
  out[offset + 2] = -ecf.y / EARTH_RADIUS_KM;
  return true;
}

export function sceneToGeodetic(x: number, y: number, z: number) {
  const { lat, lon } = xyzToLatLon(x, y, z);
  return { lat, lon, altKm: (Math.hypot(x, y, z) - 1) * EARTH_RADIUS_KM };
}
