import { API_URL, USE_MOCKS } from './env';
import type {
  AOI,
  AoiGeometry,
  AlertAssessment,
  AlertsOverview,
  Anomaly,
  BBox,
  CalendarResponse,
  EnsoResponse,
  Hotspot,
  HotspotCoverage,
  RawSensor,
  Resolution,
  TLE,
} from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Single network entry point. With VITE_USE_MOCKS=true the request is answered by
 * src/mocks with a real `Response`, so everything downstream is identical in both modes.
 * Safe to call from the main thread and from workers.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  if (USE_MOCKS) {
    const { mockFetch } = await import('@/mocks/handlers');
    res = await mockFetch(path, init);
  } else {
    res = await fetch(API_URL + path, init);
  }
  if (!res.ok) throw new ApiError(res.status, `${init?.method ?? 'GET'} ${path} → ${res.status}`);
  return res;
}

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
const json = async <T>(path: string, signal?: AbortSignal) => (await apiFetch(path, { signal })).json() as Promise<T>;

export const api = {
  searchAoi: (q: string, signal?: AbortSignal) => json<AOI[]>(`/api/aoi/search?${qs({ q })}`, signal),
  aoiAt: (lat: number, lon: number, signal?: AbortSignal) =>
    json<AOI>(`/api/aoi/at?${qs({ lat: String(lat), lon: String(lon) })}`, signal),
  calendar: (p: { aoi: string; from: string; to: string; resolution: Resolution }, signal?: AbortSignal) =>
    json<CalendarResponse>(`/api/calendar?${qs(p)}`, signal),
  hotspots: (p: { bbox: BBox; date: string; sensor: RawSensor }, signal?: AbortSignal) =>
    json<Hotspot[]>(`/api/hotspots?${qs({ bbox: p.bbox.join(','), date: p.date, sensor: p.sensor })}`, signal),
  hotspotsRange: (p: { bbox: BBox; from: string; to: string; sensor?: RawSensor | 'all' }, signal?: AbortSignal) =>
    json<Hotspot[]>(
      `/api/hotspots?${qs({ bbox: p.bbox.join(','), from: p.from, to: p.to, sensor: p.sensor ?? 'all' })}`,
      signal,
    ),
  aoiGeometry: (aoi: string, signal?: AbortSignal) => json<AoiGeometry>(`/api/aoi/geometry?${qs({ aoi })}`, signal),
  hotspotsCoverage: (p: { bbox: BBox; from: string; to: string }, signal?: AbortSignal) =>
    json<HotspotCoverage>(`/api/hotspots/coverage?${qs({ bbox: p.bbox.join(','), from: p.from, to: p.to })}`, signal),
  anomalies: (aoi: string, signal?: AbortSignal) => json<Anomaly[]>(`/api/anomalies?${qs({ aoi })}`, signal),
  enso: (aoi: string, signal?: AbortSignal) => json<EnsoResponse>(`/api/enso?${qs({ aoi })}`, signal),
  alerts: (aoi: string, signal?: AbortSignal) => json<AlertAssessment>(`/api/alerts?${qs({ aoi })}`, signal),
  alertsOverview: (signal?: AbortSignal) => json<AlertsOverview>('/api/alerts/overview', signal),
  tle: (signal?: AbortSignal) => json<TLE[]>('/api/satellites/tle', signal),
};
