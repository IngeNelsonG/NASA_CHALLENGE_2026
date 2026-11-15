import { create } from 'zustand';
import { api } from '@/lib/api';
import { bboxCenter, bboxSpan, clamp, todayIso } from '@/lib/geo';
import { RECORD_START } from '@/lib/env';
import type { AnalystHighlight, AOI, Resolution } from '@/lib/types';
import { view } from '@/scenes/view';

let selectSeq = 0;
let selectCtrl: AbortController | null = null;

/** Select the country under a click and frame it, as a name search does (ocean clicks do nothing). */
export async function selectAt(hit: { lat: number; lon: number }): Promise<void> {
  const seq = ++selectSeq;
  selectCtrl?.abort();
  const ctrl = new AbortController();
  selectCtrl = ctrl;
  try {
    const aoi = await api.aoiAt(hit.lat, hit.lon, ctrl.signal);
    if (seq !== selectSeq || ctrl.signal.aborted) return;
    if (aoi && typeof aoi.id === 'string' && Array.isArray(aoi.bbox)) useStore.getState().setAoi(aoi);
  } catch {
    /* no country there */
  }
}

export type Lang = 'en' | 'es';
export type Granularity = 'day' | 'month' | 'year';
/** MODIS and VIIRS detections are always shown together; only these context layers can be toggled. */
export type LayerId = 'density' | 'terminator' | 'orbits' | 'borders';
export type DateRange = { from: string; to: string };
export type TimeScale = 1 | 60 | 600;

/** How many previous areas "undo selection" can step back through. */
const HISTORY = 10;

/**
 * "No area selected": the whole planet. The data sections show the global monthly archive and the
 * globe draws no outline and no points until the user picks an area.
 */
export const WORLD_ID = 'world';
export const DEFAULT_AOI: AOI = { id: WORLD_ID, name: 'World', bbox: [-180, -90, 180, 90] };
export const isWorld = (aoi: AOI) => aoi.id === WORLD_ID;

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
  /** 3D globe; 2D only as the fallback when WebGL is unavailable */
  viewMode: '3d' | '2d';
  layers: Record<LayerId, boolean>;
  aoi: AOI;
  /** areas selected before the current one, most recent last (for "undo selection") */
  aoiHistory: AOI[];
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
  /** Go back to the previously selected area (e.g. after a misclick on the globe). */
  undoAoi: () => void;
  /** Cancel the selection: back to the default area (Esc or the "clear selection" button). */
  clearAoi: () => void;
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
  aoiHistory: [],
  date: todayIso(),
  granularity: 'month',
  playing: false,
  // simulated clock: at 600× a satellite circles the Earth in ~10 s (and the terminator creeps)
  timeScale: 600,
  calRange: { from: RECORD_START, to: todayIso() },
  resolution: 'month',
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
    const prev = get().aoi;
    set((s) => ({
      aoi,
      highlights: [],
      aoiHistory: prev.id === aoi.id ? s.aoiHistory : [...s.aoiHistory, prev].slice(-HISTORY),
    }));
    if (fly) get().flyToAoi();
  },
  undoAoi: () => {
    const history = get().aoiHistory;
    const prev = history[history.length - 1];
    if (!prev) return;
    set({ aoi: prev, aoiHistory: history.slice(0, -1), highlights: [] });
    get().flyToAoi();
  },
  clearAoi: () => {
    selectSeq++;
    selectCtrl?.abort();
    const prev = get().aoi;
    set({ tool: 'pan' });
    if (isWorld(prev)) return;
    set((s) => ({ aoi: DEFAULT_AOI, aoiHistory: [...s.aoiHistory, prev].slice(-HISTORY), highlights: [] }));
    get().flyToAoi();
  },
  flyToAoi: () => {
    const { aoi } = get();
    // nothing selected: step back to the whole globe, keeping the side of the Earth in view
    if (isWorld(aoi)) return view.flyTo(view.fly?.lon ?? view.lon, 8, 1);
    const { bbox } = aoi;
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


/** Display name of the current area ("Whole world" while nothing is selected). */
export const useAoiName = () => useStore((s) => (isWorld(s.aoi) ? (s.lang === 'es' ? 'Todo el mundo' : 'Whole world') : s.aoi.name));
