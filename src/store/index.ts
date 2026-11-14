import { create } from 'zustand';
import { api } from '@/lib/api';
import { bboxCenter, bboxSpan, clamp, todayIso } from '@/lib/geo';
import { RECORD_START } from '@/lib/env';
import type { AnalystHighlight, AOI, Resolution } from '@/lib/types';
import { view } from '@/scenes/view';

let selectSeq = 0;
let selectCtrl: AbortController | null = null;

/** Select country AOI at clicked coordinates, falling back to point inspection on 404/error. */
export async function selectAt(hit: { lat: number; lon: number }): Promise<void> {
  const seq = ++selectSeq;
  selectCtrl?.abort();
  const ctrl = new AbortController();
  selectCtrl = ctrl;
  try {
    const aoi = await api.aoiAt(hit.lat, hit.lon, ctrl.signal);
    if (seq !== selectSeq || ctrl.signal.aborted) return;
    if (aoi && typeof aoi.id === 'string' && Array.isArray(aoi.bbox)) {
      useStore.getState().setAoi(aoi, false);
      return;
    }
  } catch {
    if (seq !== selectSeq || ctrl.signal.aborted) return;
  }
  useStore.getState().set({ picked: hit });
}

export type Lang = 'en' | 'es';
export type Granularity = 'day' | 'month' | 'year';
/** MODIS and VIIRS detections are always shown together; only these context layers can be toggled. */
export type LayerId = 'density' | 'terminator' | 'orbits' | 'borders';
export type DateRange = { from: string; to: string };
export type TimeScale = 1 | 60 | 600;

export const DEFAULT_AOI: AOI = { id: 'co-orinoquia', name: 'Orinoquía, Colombia', bbox: [-74.0, 2.0, -67.4, 7.2] };

const storedLang = (): Lang => {
  try {
    return localStorage.getItem('lang') === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
};

type State = {
  lang: Lang;
  phase: 'intro' | 'landing';
  sceneReady: boolean;
  webgl: boolean;
  viewMode: '3d' | '2d';
  layers: Record<LayerId, boolean>;
  aoi: AOI;
  picked: { lat: number; lon: number } | null;
  date: string;
  granularity: Granularity;
  playing: boolean;
  timeScale: TimeScale;
  /** date filter of the calendar (the only data filter in the app) */
  calRange: DateRange;
  resolution: Resolution;
  tool: 'pan' | 'rect';
  hoverSat: { norad: number; x: number; y: number } | null;
  highlights: AnalystHighlight[];
  section: string;

  setLang: (l: Lang) => void;
  set: (p: Partial<State>) => void;
  toggleLayer: (id: LayerId) => void;
  setAoi: (aoi: AOI, fly?: boolean) => void;
  flyToAoi: () => void;
  /** Calendar → globe: jump the timeline to a date and bring the explorer into view. */
  focusDate: (date: string, granularity?: Granularity) => void;
  setCalRange: (r: DateRange) => void;
  /** Globe/anomalies/analyst → calendar: show a date, widening the filter if it is outside. */
  revealOnCalendar: (date: string) => void;
};

export const zoomForSpan = (spanDeg: number) => clamp(55 / Math.max(1, spanDeg), 1, 5.5);

export const useStore = create<State>((set, get) => ({
  lang: storedLang(),
  phase: 'intro',
  sceneReady: false,
  webgl: true,
  viewMode: '3d',
  layers: { density: false, terminator: true, orbits: true, borders: true },
  aoi: DEFAULT_AOI,
  picked: null,
  date: todayIso(),
  granularity: 'month',
  playing: false,
  timeScale: 60,
  calRange: { from: RECORD_START, to: todayIso() },
  resolution: 'day',
  tool: 'pan',
  hoverSat: null,
  highlights: [],
  section: 'hero',

  setLang: (lang) => {
    try {
      localStorage.setItem('lang', lang);
    } catch {
      /* storage unavailable */
    }
    document.documentElement.lang = lang;
    set({ lang });
  },
  set: (p) => set(p),
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  setAoi: (aoi, fly = true) => {
    set({ aoi, picked: null, highlights: [] });
    if (fly) get().flyToAoi();
  },
  flyToAoi: () => {
    const { bbox } = get().aoi;
    const c = bboxCenter(bbox);
    view.flyTo(c.lon, c.lat, zoomForSpan(bboxSpan(bbox)));
  },
  focusDate: (date, granularity) => {
    set({ date, playing: false, ...(granularity ? { granularity } : {}) });
    get().flyToAoi();
    document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  setCalRange: ({ from, to }) => {
    const lo = from < RECORD_START ? RECORD_START : from;
    const hi = to > todayIso() || !to ? todayIso() : to;
    set({ calRange: lo <= hi ? { from: lo, to: hi } : { from: hi, to: lo } });
  },
  revealOnCalendar: (date) => {
    const { calRange } = get();
    const patch: Partial<State> = { date, resolution: 'month' };
    if (date < calRange.from || date > calRange.to) patch.calRange = { from: RECORD_START, to: todayIso() };
    set(patch);
    document.getElementById('calendar')?.scrollIntoView({ behavior: 'smooth' });
  },
}));

/** Date range shown on the globe for the current timeline position. */
export function timelineRange(date: string, g: Granularity): { from: string; to: string } {
  const y = +date.slice(0, 4), m = +date.slice(5, 7);
  const today = todayIso();
  const cap = (d: string) => (d > today ? today : d);
  if (g === 'day') return { from: date, to: date };
  if (g === 'month') {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { from: `${date.slice(0, 7)}-01`, to: cap(`${date.slice(0, 7)}-${String(last).padStart(2, '0')}`) };
  }
  return { from: `${y}-01-01`, to: cap(`${y}-12-31`) };
}
