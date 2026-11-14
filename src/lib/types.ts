// API contracts. The mock layer and the real backend must both satisfy these exactly.

export type Sensor = 'modis' | 'viirs' | 'harmonized';
export type RawSensor = 'modis' | 'viirs';
export type Resolution = 'day' | 'week' | 'month';
export type BBox = [west: number, south: number, east: number, north: number];

// GET /api/aoi/search?q=boyaca
export type AOI = { id: string; name: string; bbox: BBox; geometry?: GeoJSON.Geometry };

// GET /api/calendar?aoi=ID&from=2000-01-01&to=2026-11-14&resolution=day|week|month
export type CalendarCell = {
  date: string; // ISO
  modis: number | null; // null = no observation
  viirs: number | null;
  harmonized: number | null;
  harmonizedLow?: number;
  harmonizedHigh?: number;
  frp?: number;
  anomalyZ?: number;
};
export type ClimatologyPoint = { doy: number; mean: number; p10: number; p90: number };
export type CalendarResponse = {
  aoi: AOI;
  resolution: string;
  cells: CalendarCell[];
  climatology: ClimatologyPoint[];
  meta: { method: string; version: string };
};

// GET /api/hotspots?bbox=W,S,E,N&date=YYYY-MM-DD&sensor=modis|viirs
export type Hotspot = {
  lat: number;
  lon: number;
  sensor: RawSensor;
  satellite: string;
  acqTime: string;
  frp: number;
  confidence: string;
  daynight: 'D' | 'N';
};

// GET /api/anomalies?aoi=ID
export type Anomaly = { start: string; end: string; zScore: number; label: string };

// GET /api/satellites/tle
export type TLE = { name: string; norad: number; instrument: 'MODIS' | 'VIIRS'; line1: string; line2: string };

// POST /api/analyst (backend proxy to Claude; SSE streaming response)
export type AnalystRequest = {
  aoiId: string;
  question: string;
  lang: 'es' | 'en';
  context?: { from: string; to: string; sensor: Sensor };
};
// The stream ends with a JSON payload: { highlights: [...] }
export type AnalystHighlight = { date: string; reason: string };

// ---- Frontend-only derived shapes (not part of the API) ----

export type HotspotBuffers = {
  count: number;
  nModis: number;
  nViirs: number;
  /** [lon, lat] pairs */
  lonlat: Float32Array;
  /** unit-sphere scene coordinates */
  xyz: Float32Array;
  /** 0 = MODIS, 1 = VIIRS */
  sensor: Float32Array;
  frp: Float32Array;
  /** [lon, lat, value01] triplets, sensor-balanced relative density */
  hex: Float32Array;
  hexRadiusDeg: number;
};

export type CalendarData = {
  response: CalendarResponse;
  /** robust colour-domain maximum (p99) per series */
  domain: Record<Sensor, number>;
};
