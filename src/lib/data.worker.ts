/// <reference lib="webworker" />
// Fetching, parsing and aggregation happen here so the main thread only receives render-ready buffers.
import { api } from './api';
import { DAY_MS, DEG, dayIdx, isoDay, latLonToXYZ } from './geo';
import type { BBox, CalendarData, Hotspot, HotspotBuffers, RawSensor, Resolution, Sensor } from './types';

export type WorkerApi = {
  calendar: (p: { aoi: string; from: string; to: string; resolution: Resolution }) => CalendarData;
  /** `track` marks the result as "what the globe is showing" for CSV export */
  hotspots: (p: { bbox: BBox; from: string; to: string; track?: boolean }) => HotspotBuffers;
  /** `key` = `${aoiId}|${resolution}` of a calendar already loaded */
  csv: (p: CsvRequest) => string;
};

/** `from`/`to`: calendar date filter (bin start dates) */
type CsvRequest = { kind: 'calendar'; key: string; from?: string; to?: string } | { kind: 'hotspots' };
const calendars = new Map<string, CalendarData>();
let lastHotspots: Hotspot[] = [];

const p99 = (values: number[]) => {
  if (!values.length) return 1;
  values.sort((a, b) => a - b);
  return Math.max(1, values[Math.floor(0.99 * (values.length - 1))]);
};

async function calendar(p: { aoi: string; from: string; to: string; resolution: Resolution }): Promise<CalendarData> {
  const response = await api.calendar(p);
  const acc: Record<Sensor, number[]> = { modis: [], viirs: [], harmonized: [] };
  for (const c of response.cells) {
    if (c.modis !== null) acc.modis.push(c.modis);
    if (c.viirs !== null) acc.viirs.push(c.viirs);
    if (c.harmonized !== null) acc.harmonized.push(c.harmonized);
  }
  const data = { response, domain: { modis: p99(acc.modis), viirs: p99(acc.viirs), harmonized: p99(acc.harmonized) } };
  calendars.set(`${p.aoi}|${p.resolution}`, data);
  return data;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/** Flat-top hex binning in a local (lon·cos φ0, lat) plane; each sensor is normalised before blending. */
function hexbin(points: Hotspot[], bbox: BBox, nM: number, nV: number) {
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]);
  const R = Math.max(0.02, span / 60);
  const cos0 = Math.cos(((bbox[1] + bbox[3]) / 2) * DEG) || 1;
  const bins = new Map<string, { q: number; r: number; v: number }>();
  const wM = nM ? 1 / nM : 0, wV = nV ? 1 / nV : 0;
  const both = nM && nV ? 0.5 : 1;
  for (const h of points) {
    const x = h.lon * cos0, y = h.lat;
    const qf = ((2 / 3) * x) / R, rf = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / R;
    let q = Math.round(qf), r = Math.round(rf);
    const s = Math.round(-qf - rf);
    const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s + qf + rf);
    if (dq > dr && dq > ds) q = -r - s;
    else if (dr > ds) r = -q - s;
    const k = q + ',' + r;
    const b = bins.get(k) ?? { q, r, v: 0 };
    b.v += (h.sensor === 'modis' ? wM : wV) * both;
    bins.set(k, b);
  }
  let max = 0;
  for (const b of bins.values()) max = Math.max(max, b.v);
  const hex = new Float32Array(bins.size * 3);
  let i = 0;
  for (const b of bins.values()) {
    hex[i++] = (R * 1.5 * b.q) / cos0;
    hex[i++] = R * Math.sqrt(3) * (b.r + b.q / 2);
    hex[i++] = max ? b.v / max : 0;
  }
  return { hex, hexRadiusDeg: R };
}

async function hotspots(p: { bbox: BBox; from: string; to: string; track?: boolean }): Promise<HotspotBuffers> {
  const jobs: { date: string; sensor: RawSensor }[] = [];
  const today = Math.floor(Date.now() / DAY_MS);
  for (let d = dayIdx(p.from); d <= Math.min(today, dayIdx(p.to)); d++) {
    jobs.push({ date: isoDay(d), sensor: 'modis' }, { date: isoDay(d), sensor: 'viirs' });
  }
  const all: Hotspot[] = [];
  await pool(jobs, 8, async (j) => {
    const rows = await api.hotspots({ bbox: p.bbox, ...j });
    for (const r of rows) all.push(r);
  });
  if (p.track) lastHotspots = all;

  const n = all.length;
  const lonlat = new Float32Array(n * 2), xyz = new Float32Array(n * 3), sensor = new Float32Array(n), frp = new Float32Array(n);
  let nModis = 0;
  for (let i = 0; i < n; i++) {
    const h = all[i];
    lonlat[i * 2] = h.lon;
    lonlat[i * 2 + 1] = h.lat;
    const [x, y, z] = latLonToXYZ(h.lat, h.lon, 1.0015);
    xyz[i * 3] = x;
    xyz[i * 3 + 1] = y;
    xyz[i * 3 + 2] = z;
    const isM = h.sensor === 'modis';
    sensor[i] = isM ? 0 : 1;
    if (isM) nModis++;
    frp[i] = h.frp;
  }
  return { count: n, nModis, nViirs: n - nModis, lonlat, xyz, sensor, frp, ...hexbin(all, p.bbox, nModis, n - nModis) };
}

function csv(p: CsvRequest): string {
  if (p.kind === 'calendar') {
    const rows = (calendars.get(p.key)?.response.cells ?? []).filter((c) => (!p.from || c.date >= p.from) && (!p.to || c.date <= p.to));
    const head = 'date,modis,viirs,harmonized,harmonized_low,harmonized_high,frp_mw,anomaly_z';
    const v = (x: number | null | undefined) => (x === null || x === undefined ? '' : String(x));
    return [head, ...rows.map((c) => [c.date, v(c.modis), v(c.viirs), v(c.harmonized), v(c.harmonizedLow), v(c.harmonizedHigh), v(c.frp), v(c.anomalyZ)].join(','))].join('\n');
  }
  const head = 'lat,lon,sensor,satellite,acq_time,frp_mw,confidence,daynight';
  return [head, ...lastHotspots.map((h) => [h.lat, h.lon, h.sensor, h.satellite, h.acqTime, h.frp, h.confidence, h.daynight].join(','))].join('\n');
}

const handlers = { calendar, hotspots, csv: async (p: CsvRequest) => csv(p) };

self.onmessage = async (e: MessageEvent<{ id: number; type: keyof typeof handlers; payload: never }>) => {
  const { id, type, payload } = e.data;
  try {
    const result = await handlers[type](payload);
    const transfer: Transferable[] = [];
    if (type === 'hotspots') {
      const b = result as HotspotBuffers;
      transfer.push(b.lonlat.buffer, b.xyz.buffer, b.sensor.buffer, b.frp.buffer, b.hex.buffer);
    }
    (self as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
