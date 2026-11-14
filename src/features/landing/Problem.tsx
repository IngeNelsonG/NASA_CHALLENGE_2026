import { useQuery } from '@tanstack/react-query';
import { scaleBand, scaleLinear } from 'd3-scale';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtDay, fmtInt, useT } from '@/app/i18n';
import { useCalendar } from '@/app/loaders';
import { SectionHeading, SensorDot, Spinner } from '@/components/ui';
import { SENSOR_COLOR } from '@/lib/colors';
import type { BBox, HotspotBuffers, RawSensor } from '@/lib/types';
import { callWorker } from '@/lib/worker-client';
import { useStore } from '@/store';

/** One sensor's detections for the AOI on one day. */
function MiniMap({ data, sensor, bbox }: { data: HotspotBuffers; sensor: RawSensor; bbox: BBox }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148,170,220,0.12)';
    for (let i = 1; i < 6; i++) {
      ctx.strokeRect((w * i) / 6, 0, 0.5, h);
      ctx.strokeRect(0, (h * i) / 6, w, 0.5);
    }
    const code = sensor === 'modis' ? 0 : 1;
    const s = sensor === 'modis' ? 4 : 2;
    ctx.fillStyle = SENSOR_COLOR[sensor];
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < data.count; i++) {
      if (data.sensor[i] !== code) continue;
      const x = ((data.lonlat[i * 2] - bbox[0]) / (bbox[2] - bbox[0])) * w;
      const y = (1 - (data.lonlat[i * 2 + 1] - bbox[1]) / (bbox[3] - bbox[1])) * h;
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  }, [data, sensor, bbox]);
  return <canvas ref={ref} aria-hidden className="h-44 w-full rounded-md border border-line bg-space-900/80 sm:h-52" />;
}

type YearRow = { year: number; modis: number; viirs: number; harmonized: number };
const LAUNCHES = [
  { year: 2012, label: 'Suomi NPP' },
  { year: 2018, label: 'NOAA-20' },
  { year: 2024, label: 'NOAA-21' },
];

/** Raw MODIS + VIIRS sum (stacked bars) against the harmonised series (line): one axis, one unit. */
function JumpChart({ rows }: { rows: YearRow[] }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const [hover, setHover] = useState<YearRow | null>(null);
  const W = 720, H = 300, m = { l: 48, r: 12, t: 34, b: 26 };
  const x = scaleBand<number>().domain(rows.map((r) => r.year)).range([m.l, W - m.r]).paddingInner(0.22);
  const max = Math.max(1, ...rows.map((r) => r.modis + r.viirs));
  const y = scaleLinear().domain([0, max]).nice(4).range([H - m.b, m.t]);
  const bw = x.bandwidth();
  const line = rows.map((r, i) => `${i ? 'L' : 'M'}${(x(r.year) ?? 0) + bw / 2},${y(r.harmonized)}`).join('');
  const shown = hover ?? rows[rows.length - 2] ?? rows[0];

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('problem.chart_aria')} onMouseLeave={() => setHover(null)}>
        {y.ticks(4).map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="rgba(148,170,220,0.14)" />
            <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-ink-dim font-mono text-[11px]">
              {fmtInt(v, lang)}
            </text>
          </g>
        ))}
        {LAUNCHES.filter((l) => x(l.year) !== undefined).map((l) => (
          <g key={l.year}>
            <line x1={(x(l.year) ?? 0) - 3} x2={(x(l.year) ?? 0) - 3} y1={m.t - 8} y2={H - m.b} stroke="#A9B4CC" strokeDasharray="3 3" strokeWidth={1} />
            <text x={(x(l.year) ?? 0) + 1} y={m.t - 12} className="fill-ink font-mono text-[11px]">
              + {l.label}
            </text>
          </g>
        ))}
        {rows.map((r) => {
          const bx = x(r.year) ?? 0;
          const yM = y(r.modis), yV = y(r.modis + r.viirs);
          return (
            <g key={r.year} onMouseEnter={() => setHover(r)} opacity={hover && hover.year !== r.year ? 0.55 : 1}>
              <rect x={bx - 2} y={m.t} width={bw + 4} height={H - m.t - m.b} fill="transparent" />
              <rect x={bx} y={yM} width={bw} height={Math.max(0, H - m.b - yM)} fill={SENSOR_COLOR.modis} rx={1.5} />
              {r.viirs > 0 && <rect x={bx} y={yV} width={bw} height={Math.max(0, yM - yV - 2)} fill={SENSOR_COLOR.viirs} rx={1.5} />}
              {r.year % 4 === 0 && (
                <text x={bx + bw / 2} y={H - 8} textAnchor="middle" className="fill-ink-dim font-mono text-[11px]">
                  {r.year}
                </text>
              )}
            </g>
          );
        })}
        <path d={line} fill="none" stroke="#04070F" strokeWidth={5} strokeLinejoin="round" />
        <path d={line} fill="none" stroke={SENSOR_COLOR.harmonized} strokeWidth={2} strokeLinejoin="round" />
        {rows.map((r) => (
          <circle key={r.year} cx={(x(r.year) ?? 0) + bw / 2} cy={y(r.harmonized)} r={hover?.year === r.year ? 4.5 : 2.5} fill={SENSOR_COLOR.harmonized} stroke="#04070F" strokeWidth={1.5} pointerEvents="none" />
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-dim">
        <span className="data text-ink">{shown?.year}</span>
        <span className="flex items-center gap-1.5">
          <SensorDot sensor="modis" shape="square" /> {t('series.modis')} <b className="data font-normal text-ink">{fmtInt(shown?.modis ?? 0, lang)}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <SensorDot sensor="viirs" shape="square" /> {t('series.viirs')} <b className="data font-normal text-ink">{fmtInt(shown?.viirs ?? 0, lang)}</b>
        </span>
        <span className="flex items-center gap-1.5">
          <SensorDot sensor="harmonized" shape="line" /> {t('series.harmonized')} <b className="data font-normal text-ink">≈ {fmtInt(shown?.harmonized ?? 0, lang)}</b>
        </span>
      </figcaption>
    </figure>
  );
}

export function Problem() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const monthly = useCalendar('month');
  const cells = monthly.data?.response.aoi.id === aoi.id ? monthly.data.response.cells : undefined;

  const rows = useMemo<YearRow[]>(() => {
    const m = new Map<number, YearRow>();
    for (const c of cells ?? []) {
      const year = +c.date.slice(0, 4);
      const r = m.get(year) ?? m.set(year, { year, modis: 0, viirs: 0, harmonized: 0 }).get(year)!;
      r.modis += c.modis ?? 0;
      r.viirs += c.viirs ?? 0;
      r.harmonized += c.harmonized ?? 0;
    }
    return [...m.values()];
  }, [cells]);

  // "Same place, same day": the middle of the busiest recent month where both sensors observed.
  const day = useMemo(() => {
    let best: { date: string; v: number } | null = null;
    for (const c of cells ?? []) if (c.date >= '2019' && c.modis !== null && c.viirs !== null && (!best || c.modis > best.v)) best = { date: c.date, v: c.modis };
    return best ? `${best.date.slice(0, 7)}-14` : null;
  }, [cells]);
  const sample = useQuery({
    queryKey: ['problem-sample', aoi.bbox.join(','), day],
    queryFn: () => callWorker('hotspots', { bbox: aoi.bbox, from: day!, to: day! }),
    enabled: !!day,
  });
  const s = sample.data;

  return (
    <section id="problem" className="section" aria-labelledby="problem-title">
      <SectionHeading id="problem-title" eyebrow={t('problem.eyebrow')} title={t('problem.title')} lead={t('problem.lead')} />
      <div className="grid gap-5 lg:grid-cols-2">
        <article className="panel p-4 sm:p-5">
          <h3 className="text-lg font-semibold">{t('problem.same_title')}</h3>
          <p className="mt-1 text-sm text-ink-dim">
            {aoi.name}
            {day && <span className="data"> · {fmtDay(day, lang)}</span>}
          </p>
          {s && day ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                {(['modis', 'viirs'] as const).map((k) => (
                  <div key={k}>
                    <MiniMap data={s} sensor={k} bbox={aoi.bbox} />
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-dim">
                      <SensorDot sensor={k} /> {k === 'modis' ? 'MODIS · 1 km' : 'VIIRS · 375 m'}
                    </p>
                    <p className="data text-2xl text-ink">{fmtInt(k === 'modis' ? s.nModis : s.nViirs, lang)}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-dim">
                {s.nModis > 0 ? t('problem.same_caption', { x: (s.nViirs / s.nModis).toFixed(1) }) : t('problem.same_caption_zero')}
              </p>
            </>
          ) : (
            <div className="grid h-60 place-items-center">
              <Spinner label={t('common.loading')} />
            </div>
          )}
        </article>
        <article className="panel p-4 sm:p-5">
          <h3 className="text-lg font-semibold">{t('problem.jump_title')}</h3>
          <p className="mt-1 text-sm text-ink-dim">{t('problem.jump_sub')}</p>
          <div className="mt-3">{rows.length ? <JumpChart rows={rows} /> : <div className="grid h-60 place-items-center"><Spinner label={t('common.loading')} /></div>}</div>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">{t('problem.jump_caption')}</p>
        </article>
      </div>
    </section>
  );
}
