// Mock backend: answers every /api/* route with a real Response, honouring the contracts in lib/types.ts.
import { fmtRatio, fmtSigned } from '@/lib/format';
import type {
  AnalystHighlight,
  AnalystRequest,
  Anomaly,
  BBox,
  CalendarResponse,
  EnsoEpisode,
  EnsoResponse,
  EnsoSeriesPoint,
  RawSensor,
  Resolution,
} from '@/lib/types';
import { resolveAoi, searchAois } from './aois';
import { calendar, hotspots } from './model';
import tle from './tle.json';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const today = () => new Date().toISOString().slice(0, 10);

function anomaliesFor(bbox: BBox): Anomaly[] {
  const { cells } = calendar(bbox, '2000-01-01', today(), 'month');
  const out: Anomaly[] = [];
  let run: { start: string; end: string; z: number } | null = null;
  const flush = () => {
    if (!run) return;
    const hi = run.z > 0;
    const a = Math.abs(run.z);
    out.push({
      start: run.start,
      end: run.end,
      zScore: run.z,
      label: `${a >= 2.5 ? 'Extreme' : a >= 2 ? 'Strong' : 'Moderate'} ${hi ? 'excess' : 'deficit'} of fire activity`,
    });
    run = null;
  };
  for (const c of cells) {
    const z = c.anomalyZ ?? 0;
    // deficits only matter when the month normally burns
    const relevant = c.harmonized !== null && (z >= 1.5 || (z <= -1.8 && (c.harmonized ?? 0) > 20));
    const d = new Date(c.date + 'T00:00:00Z');
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (relevant && run && Math.sign(run.z) === Math.sign(z)) {
      run.end = end;
      if (Math.abs(z) > Math.abs(run.z)) run.z = z;
    } else {
      flush();
      if (relevant) run = { start: c.date, end, z };
    }
  }
  flush();
  return out.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, 24);
}

function syntheticEnso(bbox: BBox): EnsoResponse {
  const { cells } = calendar(bbox, '2000-01-01', today(), 'month');
  const zByMonth = new Map(cells.map((c) => [c.date, c.anomalyZ ?? null]));
  const series: EnsoSeriesPoint[] = [];
  const endYr = 2026;
  const endMo = 9;
  for (let yr = 2000; yr <= endYr; yr++) {
    const maxMo = yr === endYr ? endMo : 12;
    for (let mo = 1; mo <= maxMo; mo++) {
      const t = (yr - 2000) * 12 + (mo - 1);
      const iso = `${yr}-${String(mo).padStart(2, '0')}-01`;
      let oni = Number((1.15 * Math.sin(t * 0.145) + 0.65 * Math.cos(t * 0.082)).toFixed(2));
      if (yr === 2026 && mo >= 5) oni = Number(Math.min(2.46, 0.95 + (mo - 5) * 0.38).toFixed(2));
      series.push({ month: iso, oni, z: zByMonth.get(iso) ?? null });
    }
  }
  const elVals: number[] = [];
  const laVals: number[] = [];
  const neuVals: number[] = [];
  for (let i = 0; i + 2 < series.length; i++) {
    const o = series[i].oni;
    const z = series[i + 2].z;
    if (o == null || z == null) continue;
    if (o >= 0.5) elVals.push(z);
    else if (o <= -0.5) laVals.push(z);
    else neuVals.push(z);
  }
  const mean = (arr: number[]) => (arr.length ? Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)) : null);
  const episodes: EnsoEpisode[] = [];
  let runStart = -1;
  let runPhase: 'EL_NINO' | 'LA_NINA' | null = null;
  const flush = (endIdx: number) => {
    if (!runPhase || runStart < 0 || endIdx - runStart + 1 < 5) return;
    let peak = 0;
    let zs = 0;
    let zn = 0;
    for (let j = runStart; j <= endIdx; j++) {
      const o = series[j].oni ?? 0;
      if (Math.abs(o) > Math.abs(peak)) peak = o;
    }
    for (let j = runStart; j <= Math.min(series.length - 1, endIdx + 2); j++) {
      const z = series[j].z;
      if (z != null) (zs += z), zn++;
    }
    episodes.push({
      phase: runPhase,
      start: series[runStart].month,
      end: series[endIdx].month,
      peak_oni: peak,
      fire_z: zn ? Number((zs / zn).toFixed(2)) : null,
    });
  };
  for (let i = 0; i < series.length; i++) {
    const o = series[i].oni ?? 0;
    const ph = o >= 0.5 ? 'EL_NINO' : o <= -0.5 ? 'LA_NINA' : null;
    if (ph && ph === runPhase) continue;
    flush(i - 1);
    runStart = ph ? i : -1;
    runPhase = ph;
  }
  flush(series.length - 1);
  const last = series[series.length - 1];
  return {
    current: { month: last.month, oni: last.oni, phase: 'EL_NINO', strength: 'very_strong' },
    series,
    episodes,
    impact: {
      lag_months: 2,
      r: 0.34,
      n: elVals.length + laVals.length + neuVals.length,
      phases: {
        EL_NINO: { months: elVals.length, mean_z: mean(elVals) },
        LA_NINA: { months: laVals.length, mean_z: mean(laVals) },
        NEUTRAL: { months: neuVals.length, mean_z: mean(neuVals) },
      },
    },
  };
}

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
};

function analystStream(req: AnalystRequest): Response {
  const aoi = resolveAoi(req.aoiId);
  const lang = req.lang === 'es' ? 'es' : 'en';
  let text: string;
  let highlights: AnalystHighlight[] = [];
  if (!aoi) {
    text = lang === 'es' ? 'No encuentro esa área de interés.' : 'I could not find that area of interest.';
  } else {
    const { cells } = calendar(aoi.bbox, '2000-01-01', today(), 'month');
    const byMonth = Array.from({ length: 12 }, () => ({ s: 0, n: 0 }));
    let m12 = 0, v12 = 0;
    for (const c of cells) {
      const mo = +c.date.slice(5, 7) - 1;
      if (c.harmonized !== null) (byMonth[mo].s += c.harmonized), byMonth[mo].n++;
      if (c.modis !== null && c.viirs !== null && c.date >= '2013') (m12 += c.modis), (v12 += c.viirs);
    }
    const means = byMonth.map((b) => (b.n ? b.s / b.n : 0));
    const total = means.reduce((a, b) => a + b, 0) || 1;
    const peak = means.indexOf(Math.max(...means));
    const season = [peak - 1, peak, peak + 1].map((i) => (i + 12) % 12);
    const share = Math.round((season.reduce((a, i) => a + means[i], 0) / total) * 100);
    const an = anomaliesFor(aoi.bbox).filter((a) => a.zScore > 0).slice(0, 3);
    const ratio = m12 ? fmtRatio(v12 / m12, lang, 1) : '—';
    const mName = (i: number) => MONTHS[lang][i];
    const ym = (iso: string) => `${mName(+iso.slice(5, 7) - 1)} ${iso.slice(0, 4)}`;
    highlights = an.map((a) => ({
      date: a.start,
      reason: lang === 'es' ? `Actividad muy por encima de lo normal (z = ${fmtSigned(a.zScore, lang, 1)})` : `Activity far above normal (z = ${fmtSigned(a.zScore, lang, 1)})`,
    }));
    text =
      lang === 'es'
        ? `[Respuesta simulada — sin backend]\n\nSobre "${req.question.trim()}" en ${aoi.name}:\n\n` +
          `• Temporada crítica: ${mName(season[0])}–${mName(season[2])} concentra cerca del ${share} % de la actividad armonizada anual, con máximo en ${mName(peak)}.\n` +
          `• Periodos inusuales: ${an.length ? an.map((a) => `${ym(a.start)} (z = ${fmtSigned(a.zScore, lang, 1)})`).join(', ') : 'ninguno destacado'}.\n` +
          `• Comparabilidad: desde 2013 VIIRS registra ~${ratio} las detecciones de MODIS en esta área. Sumar los sensores sin armonizar crea saltos artificiales en 2012, 2018 y 2024; la serie armonizada los corrige y reporta un intervalo de incertidumbre.\n\n` +
          `Marqué estos periodos en el calendario. Las cifras de esta demo son sintéticas.`
        : `[Simulated answer — no backend]\n\nOn "${req.question.trim()}" for ${aoi.name}:\n\n` +
          `• Critical season: ${mName(season[0])}–${mName(season[2])} holds about ${share}% of the yearly harmonized activity, peaking in ${mName(peak)}.\n` +
          `• Unusual periods: ${an.length ? an.map((a) => `${ym(a.start)} (z = ${fmtSigned(a.zScore, lang, 1)})`).join(', ') : 'none stand out'}.\n` +
          `• Comparability: since 2013 VIIRS reports ~${ratio} the MODIS detections in this area. Adding sensors without harmonizing creates artificial jumps in 2012, 2018 and 2024; the harmonized series corrects them and carries an uncertainty interval.\n\n` +
          `I marked these periods on the calendar. Figures in this demo are synthetic.`;
  }

  const enc = new TextEncoder();
  const words = text.split(/(?<=\s)/);
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      await sleep(350);
      for (let i = 0; i < words.length; i += 2) {
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ delta: words.slice(i, i + 2).join('') })}\n\n`));
        await sleep(28);
      }
      ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ highlights })}\n\n`));
      ctrl.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

export async function mockFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, 'http://mock.local');
  const q = url.searchParams;
  const route = url.pathname;
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  if (route === '/api/aoi/search') {
    await sleep(120);
    return jsonRes(searchAois(q.get('q') ?? ''));
  }
  if (route === '/api/aoi/at') {
    return jsonRes({ detail: 'No country at this point' }, 404);
  }
  if (route === '/api/calendar') {
    const aoi = resolveAoi(q.get('aoi') ?? '');
    if (!aoi) return jsonRes({ error: 'unknown aoi' }, 404);
    const resolution = (q.get('resolution') ?? 'day') as Resolution;
    const body: CalendarResponse = {
      aoi: { id: aoi.id, name: aoi.name, bbox: aoi.bbox },
      resolution,
      ...calendar(aoi.bbox, q.get('from') ?? '2000-01-01', q.get('to') ?? today(), resolution),
      meta: { method: 'mock: MODIS-equivalent inverse-variance blend (synthetic data)', version: 'mock-0.1' },
    };
    return jsonRes(body);
  }
  if (route === '/api/hotspots') {
    const bbox = (q.get('bbox') ?? '').split(',').map(Number);
    if (bbox.length !== 4 || bbox.some(Number.isNaN)) return jsonRes({ error: 'bad bbox' }, 400);
    return jsonRes(hotspots(bbox as BBox, q.get('date') ?? today(), (q.get('sensor') ?? 'modis') as RawSensor));
  }
  if (route === '/api/anomalies') {
    const aoi = resolveAoi(q.get('aoi') ?? '');
    if (!aoi) return jsonRes({ error: 'unknown aoi' }, 404);
    await sleep(100);
    return jsonRes(anomaliesFor(aoi.bbox));
  }
  if (route === '/api/enso') {
    const aoi = resolveAoi(q.get('aoi') ?? '');
    if (!aoi) return jsonRes({ error: 'unknown aoi' }, 404);
    await sleep(100);
    return jsonRes(syntheticEnso(aoi.bbox));
  }
  if (route === '/api/aoi/geometry') {
    const aoi = resolveAoi(q.get('aoi') ?? '');
    if (!aoi) return jsonRes({ error: 'unknown aoi' }, 404);
    // the mock gazetteer has boxes only: countries are drawn by the client, the rest keep the box
    const country = aoi.kind === 'country';
    return jsonRes({ id: aoi.id, kind: country ? 'country' : 'box', country: country ? aoi.name : null, geometry: null });
  }
  if (route === '/api/v1/explain') {
    const es = q.get('lang') !== 'en';
    const summary = es ? 'Modo demo: la explicación del mes se escribe con los datos reales del servidor.' : 'Demo mode: the month explanation is written from the real server data.';
    return jsonRes({ summary, generated_by: 'template' });
  }
  if (route === '/api/hotspots/warm') return jsonRes({ queued: false });
  if (route === '/api/hotspots/coverage') return jsonRes({ source: 'archive', firmsConfigured: false, maxDays: 62 });
  if (route === '/api/satellites/tle') return jsonRes(tle);
  if (route === '/api/analyst' && init?.method === 'POST') {
    return analystStream(JSON.parse(String(init.body ?? '{}')) as AnalystRequest);
  }
  return jsonRes({ error: 'not found' }, 404);
}
