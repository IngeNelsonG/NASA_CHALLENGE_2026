// Synthetic fire-activity model behind every mock endpoint.
// NOT real data: it only reproduces the *shape* of the problem — seasonality, inter-annual
// variability, multi-day episodes, sensor start dates, platform count changes, outages and gaps —
// so the UI can be built and demoed without the backend. Calendar counts and hotspot points
// come from the same generator, so they always agree.
import { DAY_MS, daysInYear, yearStartIdx } from '@/lib/geo';
import type { BBox, CalendarCell, ClimatologyPoint, Hotspot, RawSensor, Resolution } from '@/lib/types';
import { peakForBBox } from './aois';

const D = (s: string) => Math.floor(Date.parse(s + 'T00:00:00Z') / DAY_MS);
export const RECORD_START_IDX = D('2000-01-01');

// Platform availability (first-light dates approximate; outages illustrative).
const PLATFORMS = {
  Terra: { sensor: 'modis', start: D('2000-02-24'), share: 0.45, out: [[D('2003-12-17'), D('2003-12-23')], [D('2016-02-18'), D('2016-02-27')], [D('2022-10-11'), D('2022-10-23')]] },
  Aqua: { sensor: 'modis', start: D('2002-07-04'), share: 0.55, out: [[D('2020-08-16'), D('2020-09-02')]] },
  'Suomi NPP': { sensor: 'viirs', start: D('2012-01-20'), share: 1, out: [[D('2022-07-26'), D('2022-08-10')]] },
  'NOAA-20': { sensor: 'viirs', start: D('2018-04-01'), share: 1, out: [] },
  'NOAA-21': { sensor: 'viirs', start: D('2024-01-17'), share: 1, out: [] },
} as const satisfies Record<string, { sensor: RawSensor; start: number; share: number; out: readonly (readonly [number, number])[] }>;
type PlatformName = keyof typeof PLATFORMS;
const NAMES = Object.keys(PLATFORMS) as PlatformName[];

/** Mean VIIRS-375 m detections per platform for each MODIS (Terra+Aqua) detection in this synthetic world. */
const K_VIIRS = 3.4;

// ---- deterministic randomness ----
export function mix(...n: number[]): number {
  let h = 0x9e3779b9;
  for (const x of n) {
    h ^= x | 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}
const u = (...n: number[]) => mix(...n) / 4294967296;
export function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
function poisson(r: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss(r)));
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= r();
  } while (p > L);
  return k - 1;
}
/** smooth 1-D value noise in 0..1 */
function noise(seed: number, x: number): number {
  const i = Math.floor(x), f = x - i;
  const s = f * f * (3 - 2 * f);
  return u(seed, i) * (1 - s) + u(seed, i + 1) * s;
}

// ---- model ----
export type Site = { key: number; bbox: BBox; base: number; peakDoy: number; sigma: number };

export function siteFor(bbox: BBox): Site {
  const key = strHash(bbox.map((v) => v.toFixed(2)).join(','));
  const area = Math.max(0.01, (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]));
  const base = Math.min(150, 3 + 4.5 * Math.sqrt(area)) * (0.7 + 0.6 * u(key, 1));
  return { key, bbox, base, peakDoy: peakForBBox(bbox), sigma: 24 + 10 * u(key, 2) };
}

const active = (name: PlatformName, d: number) => {
  const p = PLATFORMS[name];
  return d >= p.start && !p.out.some(([a, b]) => d >= a && d <= b);
};

export type DayModel = {
  modis: number | null;
  viirs: number | null;
  harmonized: number | null;
  low: number;
  high: number;
  frp: number;
  lambda: number;
  platforms: PlatformName[];
};

export function dayModel(site: Site, d: number): DayModel {
  const date = new Date(d * DAY_MS);
  const y = date.getUTCFullYear();
  const doy = d - yearStartIdx(y) + 1;
  const n = daysInYear(y);
  let dd = Math.abs(doy - site.peakDoy);
  dd = Math.min(dd, n - dd);
  const season = 0.03 + Math.exp(-0.5 * (dd / site.sigma) ** 2);
  const yearF = Math.exp(1.7 * (noise(site.key ^ 0x51, (d - site.peakDoy + 182) / 365.25) - 0.5));
  const episode = (1 + 3 * Math.max(0, noise(site.key ^ 0x77, d / 5) - 0.58) / 0.42) * (0.55 + 0.9 * noise(site.key ^ 0x99, d / 11));
  const lambda = site.base * season * yearF * episode;

  const platforms = NAMES.filter((p) => active(p, d));
  const cloud = u(site.key, d, 7) < 0.012 || u(site.key, Math.floor(d / 4), 8) < 0.006;
  const share = platforms.reduce((s, p) => s + (PLATFORMS[p].sensor === 'modis' ? PLATFORMS[p].share : 0), 0);
  const nV = platforms.filter((p) => PLATFORMS[p].sensor === 'viirs').length;

  const r = mulberry32(mix(site.key, d, 3));
  const modis = share === 0 || cloud ? null : poisson(r, lambda * share * Math.exp(0.22 * gauss(r)));
  const viirs = nV === 0 || cloud ? null : poisson(r, lambda * K_VIIRS * nV * Math.exp(0.22 * gauss(r)));

  // Harmonised = MODIS (Terra+Aqua) equivalent, inverse-variance blend of both estimates.
  let num = 0, den = 0;
  if (modis !== null) {
    const est = modis / share, v = (modis + 1) / share ** 2 + (share < 1 ? (0.2 * est) ** 2 : 0);
    num += est / v;
    den += 1 / v;
  }
  if (viirs !== null) {
    const k = K_VIIRS * nV, est = viirs / k, v = (viirs + 1) / k ** 2 + (0.12 * est) ** 2;
    num += est / v;
    den += 1 / v;
  }
  if (den === 0) return { modis, viirs, harmonized: null, low: 0, high: 0, frp: 0, lambda, platforms };
  const h = num / den, sd = Math.sqrt(1 / den);
  return {
    modis,
    viirs,
    harmonized: h,
    low: Math.max(0, h - 1.64 * sd),
    high: h + 1.64 * sd,
    frp: h * 17 * Math.exp(0.35 * gauss(r)),
    lambda,
    platforms,
  };
}

// ---- calendar ----
type Full = { from: number; to: number; days: DayModel[] };
const cache = new Map<number, Full>();
function fullRecord(site: Site): Full {
  const today = Math.floor(Date.now() / DAY_MS);
  const hit = cache.get(site.key);
  if (hit && hit.to === today) return hit;
  const days: DayModel[] = [];
  for (let d = RECORD_START_IDX; d <= today; d++) days.push(dayModel(site, d));
  const full = { from: RECORD_START_IDX, to: today, days };
  cache.set(site.key, full);
  return full;
}

type Bin = { start: number; year: number; slot: number; doy: number; cell: CalendarCell };
const r1 = (v: number) => Math.round(v * 10) / 10;
const iso = (d: number) => new Date(d * DAY_MS).toISOString().slice(0, 10);

function binsFor(site: Site, resolution: Resolution): Bin[] {
  const full = fullRecord(site);
  const map = new Map<number, { bin: Bin; m: number | null; v: number | null; h: number | null; lo: number; hi: number; frp: number; varSum: number; days: number; obs: number; full: number }>();
  const order: number[] = [];
  for (let d = full.from; d <= full.to; d++) {
    const date = new Date(d * DAY_MS);
    const year = date.getUTCFullYear();
    const ys = yearStartIdx(year);
    const doy = d - ys + 1;
    let slot: number, start: number, len: number;
    if (resolution === 'day') (slot = doy - 1), (start = d), (len = 1);
    else if (resolution === 'week') (slot = Math.floor((doy - 1) / 7)), (start = ys + slot * 7), (len = Math.min(7, daysInYear(year) - slot * 7));
    else (slot = date.getUTCMonth()), (start = Math.floor(Date.UTC(year, slot, 1) / DAY_MS)), (len = new Date(Date.UTC(year, slot + 1, 0)).getUTCDate());
    const id = year * 1000 + slot;
    let e = map.get(id);
    if (!e) {
      e = { bin: { start, year, slot, doy: start - ys + 1, cell: { date: iso(start), modis: null, viirs: null, harmonized: null } }, m: null, v: null, h: null, lo: 0, hi: 0, frp: 0, varSum: 0, days: 0, obs: 0, full: len };
      map.set(id, e);
      order.push(id);
    }
    const m = full.days[d - full.from];
    e.days++;
    if (m.harmonized !== null) e.obs++;
    if (m.modis !== null) e.m = (e.m ?? 0) + m.modis;
    if (m.viirs !== null) e.v = (e.v ?? 0) + m.viirs;
    if (m.harmonized !== null) {
      e.h = (e.h ?? 0) + m.harmonized;
      e.varSum += ((m.high - m.low) / 3.28) ** 2;
      e.frp += m.frp;
    }
  }
  const complete = new Set<Bin>();
  const bins = order.map((id) => {
    const e = map.get(id)!;
    const c = e.bin.cell;
    c.modis = e.m;
    c.viirs = e.v;
    // Under half of the elapsed days observed → not enough to estimate the bin: stays "no observation".
    if (e.h !== null && e.obs / e.days >= 0.5) {
      const fill = e.days / e.obs; // scale to the unobserved days; the interval widens with it
      const h = e.h * fill, sd = Math.sqrt(e.varSum) * fill * (1 + (fill - 1));
      c.harmonized = r1(h);
      c.harmonizedLow = r1(Math.max(0, h - 1.64 * sd));
      c.harmonizedHigh = r1(h + 1.64 * sd);
      c.frp = Math.round(e.frp * fill);
      if (e.days >= e.full) complete.add(e.bin);
    }
    return e.bin;
  });

  // climatology + z-score per slot of the year (day resolution pools a ±7-day window)
  const bySlot = new Map<number, number[]>();
  for (const b of bins) if (b.cell.harmonized !== null && complete.has(b)) (bySlot.get(b.slot) ?? bySlot.set(b.slot, []).get(b.slot)!).push(b.cell.harmonized);
  const nSlots = resolution === 'day' ? 366 : resolution === 'week' ? 53 : 12;
  const win = resolution === 'day' ? 7 : 0;
  const stats = new Map<number, { mu: number; sd: number }>();
  for (let s = 0; s < nSlots; s++) {
    const logs: number[] = [];
    for (let k = -win; k <= win; k++) for (const v of bySlot.get((s + k + nSlots) % nSlots) ?? []) logs.push(Math.log1p(v));
    if (!logs.length) continue;
    const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
    const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, logs.length - 1));
    stats.set(s, { mu, sd: Math.max(0.25, sd) });
  }
  for (const b of bins) {
    const st = stats.get(b.slot);
    // the bin still in progress (current week/month) is not comparable with complete ones
    if (st && b.cell.harmonized !== null && complete.has(b)) b.cell.anomalyZ = Math.round(((Math.log1p(b.cell.harmonized) - st.mu) / st.sd) * 100) / 100;
  }
  return bins;
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] ?? 0;

export function calendar(bbox: BBox, from: string, to: string, resolution: Resolution): { cells: CalendarCell[]; climatology: ClimatologyPoint[] } {
  const site = siteFor(bbox);
  const bins = binsFor(site, resolution);
  const a = D(from), b = D(to);
  const groups = new Map<number, { doy: number; v: number[] }>();
  for (const bin of bins) {
    if (bin.cell.harmonized === null) continue;
    (groups.get(bin.slot) ?? groups.set(bin.slot, { doy: bin.doy, v: [] }).get(bin.slot)!).v.push(bin.cell.harmonized);
  }
  let climatology = [...groups.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([, g]) => {
      const s = g.v.slice().sort((x, y) => x - y);
      return { doy: g.doy, mean: s.reduce((p, c) => p + c, 0) / s.length, p10: quantile(s, 0.1), p90: quantile(s, 0.9) };
    });
  if (resolution === 'day') {
    // 15-day circular smoothing so the daily profile is readable
    const n = climatology.length;
    climatology = climatology.map((c, i) => {
      let mean = 0, p10 = 0, p90 = 0;
      for (let k = -7; k <= 7; k++) {
        const o = climatology[(i + k + n) % n];
        mean += o.mean;
        p10 += o.p10;
        p90 += o.p90;
      }
      return { doy: c.doy, mean: mean / 15, p10: p10 / 15, p90: p90 / 15 };
    });
  }
  return {
    cells: bins.filter((x) => x.start >= a && x.start <= b).map((x) => x.cell),
    climatology: climatology.map((c) => ({ doy: c.doy, mean: r1(c.mean), p10: r1(c.p10), p90: r1(c.p90) })),
  };
}

// ---- hotspots ----
const VIIRS_CONF = ['l', 'n', 'n', 'n', 'h'];

export function hotspots(bbox: BBox, date: string, sensor: RawSensor): Hotspot[] {
  const site = siteFor(bbox);
  const d = D(date);
  if (d < RECORD_START_IDX || d > Math.floor(Date.now() / DAY_MS)) return [];
  const m = dayModel(site, d);
  const count = sensor === 'modis' ? m.modis : m.viirs;
  if (!count) return [];
  const [w, s, e, n] = bbox;
  const dx = e - w, dy = n - s;

  // Fire-prone zones are fixed per site; today's fires sit inside them and are shared by both sensors.
  const zr = mulberry32(mix(site.key, 11));
  const zones = Array.from({ length: 14 }, () => ({ x: 0.08 + 0.84 * zr(), y: 0.08 + 0.84 * zr(), w: 0.2 + zr() }));
  const zTotal = zones.reduce((a, z) => a + z.w, 0);
  const fr = mulberry32(mix(site.key, d, 13));
  const nFires = Math.max(1, Math.round(m.lambda / 3.5));
  const fires = Array.from({ length: nFires }, () => {
    let t = fr() * zTotal, z = zones[0];
    for (const c of zones) {
      z = c;
      if ((t -= c.w) <= 0) break;
    }
    return { lon: w + dx * (z.x + 0.07 * gauss(fr)), lat: s + dy * (z.y + 0.07 * gauss(fr)), size: 0.4 + 2.2 * fr() ** 2 };
  });
  const fTotal = fires.reduce((a, f) => a + f.size, 0);

  const plats = m.platforms.filter((p) => PLATFORMS[p].sensor === sensor);
  const pTotal = plats.reduce((a, p) => a + PLATFORMS[p].share, 0);
  const r = mulberry32(mix(site.key, d, sensor === 'modis' ? 17 : 19));
  const jitter = sensor === 'modis' ? 0.012 : 0.006;
  const out: Hotspot[] = [];
  for (let i = 0; i < count; i++) {
    let t = r() * fTotal, f = fires[0];
    for (const c of fires) {
      f = c;
      if ((t -= c.size) <= 0) break;
    }
    const spread = jitter * (1 + 2.5 * f.size);
    const lon = Math.min(e, Math.max(w, f.lon + spread * gauss(r)));
    const lat = Math.min(n, Math.max(s, f.lat + spread * gauss(r)));
    let pt = r() * pTotal, sat = plats[0];
    for (const p of plats) {
      sat = p;
      if ((pt -= PLATFORMS[p].share) <= 0) break;
    }
    const day = r() < 0.82;
    const localH = (sat === 'Terra' ? 10.5 : 13.5) + (day ? 0 : 12) + 0.4 * gauss(r);
    const utcMin = Math.round((((localH - lon / 15) % 24) + 24) % 24 * 60);
    const acq = `${date}T${String(Math.floor(utcMin / 60) % 24).padStart(2, '0')}:${String(utcMin % 60).padStart(2, '0')}:00Z`;
    out.push({
      lat: Math.round(lat * 1e4) / 1e4,
      lon: Math.round(lon * 1e4) / 1e4,
      sensor,
      satellite: sat,
      acqTime: acq,
      frp: r1(Math.exp((sensor === 'modis' ? 2.7 : 1.4) + 0.9 * gauss(r))),
      confidence: sensor === 'modis' ? String(Math.min(100, Math.round(45 + 55 * r()))) : VIIRS_CONF[Math.floor(r() * VIIRS_CONF.length)],
      daynight: day ? 'D' : 'N',
    });
  }
  return out;
}
