import { create } from 'zustand';
import { bboxCenter, bboxSpan, clamp, todayIso } from '@/lib/geo';
import type { AnalystHighlight, AOI, Resolution, Sensor } from '@/lib/types';
import { view } from '@/scenes/view';

export type Lang = 'en' | 'es';
export type Granularity = 'day' | 'month' | 'year';
export type LayerId = 'modis' | 'viirs' | 'density' | 'terminator' | 'orbits' | 'borders';
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
  series: Sensor;
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
};

export const zoomForSpan = (spanDeg: number) => clamp(55 / Math.max(1, spanDeg), 1, 5.5);

export const useStore = create<State>((set, get) => ({
  lang: storedLang(),
  phase: 'intro',
  sceneReady: false,
  webgl: true,
  viewMode: '3d',
  layers: { modis: true, viirs: true, density: false, terminator: true, orbits: true, borders: true },
  aoi: DEFAULT_AOI,
  picked: null,
  date: todayIso(),
  granularity: 'month',
  playing: false,
  timeScale: 60,
  series: 'harmonized',
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
