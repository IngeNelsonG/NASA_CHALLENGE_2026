// Mock backend: answers every /api/* route with a real Response, honouring the contracts in lib/types.ts.
import type { AnalystHighlight, AnalystRequest, Anomaly, BBox, CalendarResponse, RawSensor, Resolution } from '@/lib/types';
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
    const ratio = m12 ? (v12 / m12).toFixed(1) : '—';
    const mName = (i: number) => MONTHS[lang][i];
    const ym = (iso: string) => `${mName(+iso.slice(5, 7) - 1)} ${iso.slice(0, 4)}`;
    highlights = an.map((a) => ({
      date: a.start,
      reason: lang === 'es' ? `Actividad muy por encima de lo normal (z = ${a.zScore.toFixed(1)})` : `Activity far above normal (z = ${a.zScore.toFixed(1)})`,
    }));
    text =
      lang === 'es'
        ? `[Respuesta simulada — sin backend]\n\nSobre "${req.question.trim()}" en ${aoi.name}:\n\n` +
          `• Temporada crítica: ${mName(season[0])}–${mName(season[2])} concentra cerca del ${share}% de la actividad armonizada anual, con máximo en ${mName(peak)}.\n` +
          `• Periodos inusuales: ${an.length ? an.map((a) => `${ym(a.start)} (z = ${a.zScore.toFixed(1)})`).join(', ') : 'ninguno destacado'}.\n` +
          `• Comparabilidad: desde 2013 VIIRS registra ~${ratio}× las detecciones de MODIS en esta área. Sumar los sensores sin armonizar crea saltos artificiales en 2012, 2018 y 2024; la serie armonizada los corrige y reporta un intervalo de incertidumbre.\n\n` +
          `Marqué estos periodos en el calendario. Las cifras de esta demo son sintéticas.`
        : `[Simulated answer — no backend]\n\nOn "${req.question.trim()}" for ${aoi.name}:\n\n` +
          `• Critical season: ${mName(season[0])}–${mName(season[2])} holds about ${share}% of the yearly harmonized activity, peaking in ${mName(peak)}.\n` +
          `• Unusual periods: ${an.length ? an.map((a) => `${ym(a.start)} (z = ${a.zScore.toFixed(1)})`).join(', ') : 'none stand out'}.\n` +
          `• Comparability: since 2013 VIIRS reports ~${ratio}× the MODIS detections in this area. Adding sensors without harmonizing creates artificial jumps in 2012, 2018 and 2024; the harmonized series corrects them and carries an uncertainty interval.\n\n` +
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
  if (route === '/api/aoi/geometry') {
    const aoi = resolveAoi(q.get('aoi') ?? '');
    if (!aoi) return jsonRes({ error: 'unknown aoi' }, 404);
    // the mock gazetteer has boxes only: countries are drawn by the client, the rest keep the box
    const country = aoi.kind === 'country';
    return jsonRes({ id: aoi.id, kind: country ? 'country' : 'box', country: country ? aoi.name : null, geometry: null });
  }
  if (route === '/api/hotspots/coverage') return jsonRes({ source: 'archive', firmsConfigured: false, maxDays: 62 });
  if (route === '/api/satellites/tle') return jsonRes(tle);
  if (route === '/api/analyst' && init?.method === 'POST') {
    return analystStream(JSON.parse(String(init.body ?? '{}')) as AnalystRequest);
  }
  return jsonRes({ error: 'not found' }, 404);
}
