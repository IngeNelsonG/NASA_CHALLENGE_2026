// API contracts. The mock layer and the real backend must both satisfy these exactly.

export type Sensor = 'modis' | 'viirs' | 'harmonized';
export type RawSensor = 'modis' | 'viirs';
export type Resolution = 'day' | 'week' | 'month';
export type BBox = [west: number, south: number, east: number, north: number];

// GET /api/aoi/search?q=boyaca
export type AOI = { id: string; name: string; bbox: BBox; geometry?: GeoJSON.Geometry };

// GET /api/aoi/geometry?aoi=ID — real outline; countries come back without geometry (drawn
// from the client's Natural Earth layer) and custom boxes keep their rectangle.
export type AoiGeometry = { id: string; kind: string; country: string | null; geometry: GeoJSON.Geometry | null };

// GET /api/hotspots/coverage?bbox=&from=&to= — where the points for an area come from.
//   archive: local point archive (Colombia) · firms: live NASA FIRMS · partial: only the part inside
//   the archive · too_long: span longer than maxDays for FIRMS · none: no point source available
export type HotspotCoverage = { source: 'archive' | 'firms' | 'partial' | 'too_long' | 'none'; firmsConfigured: boolean; maxDays: number };

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
  meta: { method: string; version: string; ratio?: number; overlapMonths?: number; dataset?: string };
};

// GET /api/hotspots?bbox=W,S,E,N&date=YYYY-MM-DD&sensor=modis|viirs
export type Hotspot = {
  lat: number;
  lon: number;
  sensor: RawSensor;
  satellite: string;
  acqTime: string;
  /** YYYY-MM-DD (optional; range queries need it to tell days apart) */
  acqDate?: string | null;
  frp: number;
  confidence: string;
  daynight: 'D' | 'N';
};

// GET /api/anomalies?aoi=ID
export type Anomaly = { start: string; end: string; zScore: number; label: string };

// GET /api/satellites/tle
export type TLE = { name: string; norad: number; instrument: 'MODIS' | 'VIIRS'; line1: string; line2: string };

// POST /api/analyst (deterministic statistical and radiometric analyst; SSE streaming response)
export type AnalystRequest = {
  aoiId: string;
  question: string;
  lang: 'es' | 'en';
  context?: { from: string; to: string; sensor: Sensor };
  /** earlier turns of the help chat, oldest first */
  history?: { role: 'user' | 'assistant'; content: string }[];
};
// The stream ends with a JSON payload: { highlights: [...] }
export type AnalystHighlight = { date: string; reason: string };

export type EnsoPhase = 'EL_NINO' | 'LA_NINA' | 'NEUTRAL' | 'UNKNOWN';
export type EnsoStrength = 'weak' | 'moderate' | 'strong' | 'very_strong';

// GET /api/enso?aoi=ID
export type EnsoSeriesPoint = {
  month: string;
  oni: number | null;
  z: number | null;
};

export type EnsoEpisode = {
  phase: 'EL_NINO' | 'LA_NINA';
  start: string;
  end: string;
  peak_oni: number;
  fire_z: number | null;
};

export type EnsoPhaseStats = {
  months: number;
  mean_z: number | null;
};

export type EnsoResponse = {
  current: {
    month: string | null;
    oni: number | null;
    phase: EnsoPhase;
    strength: EnsoStrength | null;
  };
  series: EnsoSeriesPoint[];
  episodes: EnsoEpisode[];
  impact: {
    lag_months: number;
    r: number | null;
    n: number;
    phases: {
      EL_NINO: EnsoPhaseStats;
      LA_NINA: EnsoPhaseStats;
      NEUTRAL: EnsoPhaseStats;
    };
  };
};

// GET /api/alerts?aoi=ID
export type AlertAuthority = {
  code: string;
  name: string;
  level: 'national' | 'departmental' | 'regional_environmental' | 'international';
  role_es: string;
  role_en: string;
  portal: string | null;
};

export type AlertAssessment = {
  id: string;
  aoi_id: string;
  region_name: string;
  department: string | null;
  country: string | null;
  severity: 'CRITICAL' | 'WARNING' | 'WATCH' | 'NORMAL';
  severity_rank: number;
  severity_label_es: string;
  severity_label_en: string;
  reference_month: string;
  latest_harmonized: number;
  climatology_median: number;
  climatology_q25: number;
  climatology_q75: number;
  climatology_p90: number;
  anomaly_ratio: number;
  z_score: number;
  robust_z: number;
  persistence_months: number;
  trend_direction: 'ACCELERATING' | 'PERSISTENT' | 'STABLE' | 'RECEDING';
  unseasonal: boolean;
  oni_value: number | null;
  enso_phase: EnsoPhase;
  nrt_detections: number | null;
  nrt_percent_of_normal: number | null;
  headline_es: string;
  headline_en: string;
  technical_summary_es: string;
  technical_summary_en: string;
  recommended_actions_es: string[];
  recommended_actions_en: string[];
  authorities: AlertAuthority[];
  protocol: string;
};

export type AlertsOverview = {
  countries: AlertAssessment[];
  colombia: AlertAssessment[];
};

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
  /** day with the most detections in the window (null when unknown) */
  peakDay: string | null;
};

export type CalendarData = {
  response: CalendarResponse;
  /** robust colour-domain maximum (p99) per series */
  domain: Record<Sensor, number>;
};
