import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useT, type Key } from '@/app/i18n';
import { useCalendar } from '@/app/loaders';
import { SectionHeading } from '@/components/ui';
import { api } from '@/lib/api';
import { CHART, SENSOR_COLOR, SEV_COLOR } from '@/lib/colors';
import { fmtDec, fmtInt, fmtRatio, fmtSigma, fmtSigned, fmtTempC } from '@/lib/format';
import { useStore } from '@/store';

const DATASET_LABEL: Record<string, Key> = {
  'firms-archive': 'trans.dataset_firms_archive',
  'firms-global-monthly': 'trans.dataset_firms_global',
  'synthetic-sample': 'trans.dataset_synthetic',
};

const METHOD_ITEMS: { n: string; title: Key; eq?: Key; body: Key }[] = [
  { n: '01', title: 'trans.s1_t', eq: 'trans.s1_eq', body: 'trans.s1_b' },
  { n: '02', title: 'trans.s2_t', eq: 'trans.s2_eq', body: 'trans.s2_b' },
  { n: '03', title: 'trans.s3_t', eq: 'trans.s3_eq', body: 'trans.s3_b' },
  { n: '04', title: 'trans.s4_t', eq: 'trans.s4_eq', body: 'trans.s4_b' },
  { n: '05', title: 'trans.s5_t', eq: 'trans.s5_eq', body: 'trans.s5_b' },
  { n: '06', title: 'trans.life_title', body: 'trans.life_b' },
];

/** Exact Planck spectral radiance shape B(lambda_um, T_kelvin) normalized to [0, 1] per curve. */
function planckCurvePath(tempK: number, w: number, h: number, padX: number, padY: number): string {
  const minLam = 2.0;
  const maxLam = 14.5;
  const c2 = 14387.77; // h*c / k_B in µm·K
  const samples: { lam: number; val: number }[] = [];
  let maxVal = 0;
  for (let i = 0; i <= 90; i++) {
    const lam = minLam + (i / 90) * (maxLam - minLam);
    const val = 1 / (Math.pow(lam, 5) * (Math.exp(c2 / (lam * tempK)) - 1));
    if (val > maxVal) maxVal = val;
    samples.push({ lam, val });
  }
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  return samples
    .map((pt, idx) => {
      const x = padX + ((pt.lam - minLam) / (maxLam - minLam)) * innerW;
      const y = h - padY - (pt.val / (maxVal || 1)) * innerH;
      return `${idx === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function lamToX(lam: number, w: number, padX: number): number {
  return padX + ((lam - 2.0) / (14.5 - 2.0)) * (w - padX * 2);
}

function PlanckWienDiagram() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const w = 860;
  const h = 250;
  const padX = 46;
  const padY = 34;

  const firePath = useMemo(() => planckCurvePath(800, w, h, padX, padY), []);
  const bgPath = useMemo(() => planckCurvePath(300, w, h, padX, padY), []);

  const bands = [
    { lam: 3.74, label: `VIIRS I4 · ${fmtDec(3.74, lang, 2)} µm`, color: SENSOR_COLOR.viirs, row: 0 },
    { lam: 3.9, label: `GOES B7 · ${fmtDec(3.9, lang, 2)} µm`, color: SEV_COLOR.normal, row: 1 },
    { lam: 3.96, label: `MODIS 21/22 · ${fmtDec(3.96, lang, 2)} µm`, color: SENSOR_COLOR.modis, row: 2 },
    { lam: 11.2, label: t('trans.tir_bg', { lam: fmtDec(11.2, lang, 1) }), color: CHART.axis, row: 0 },
    { lam: 13.3, label: `GOES B16 CO₂ · ${fmtDec(13.3, lang, 1)} µm`, color: SEV_COLOR.watch, row: 1 },
  ];

  return (
    <div className="panel p-4 sm:p-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-ink">{t('trans.wien_title')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">{t('trans.wien_lead')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-dim">
          <span className="flex items-center gap-1.5">
            <i aria-hidden className="inline-block h-0.5 w-4 bg-modis" /> 800 K (λ_max = {fmtDec(3.62, lang, 2)} µm)
          </span>
          <span className="flex items-center gap-1.5">
            <i aria-hidden className="inline-block h-0.5 w-4 bg-viirs" /> 300 K (λ_max = {fmtDec(9.66, lang, 2)} µm)
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full min-w-[540px]"
          role="img"
          aria-label={t('trans.wien_title')}
        >
          <rect
            x={lamToX(3.5, w, padX)}
            y={padY - 4}
            width={lamToX(4.2, w, padX) - lamToX(3.5, w, padX)}
            height={h - padY * 2 + 4}
            fill={SENSOR_COLOR.modis}
            fillOpacity={0.1}
            rx="4"
          />
          <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke={CHART.grid} strokeWidth="1" />

          {bands.map((b) => {
            const x = lamToX(b.lam, w, padX);
            const yLabel = padY + 12 + b.row * 16;
            return (
              <g key={b.label}>
                <line x1={x} y1={yLabel + 4} x2={x} y2={h - padY} stroke={b.color} strokeWidth="1.2" strokeDasharray="3 3" opacity="0.85" />
                <circle cx={x} cy={h - padY} r="3" fill={b.color} />
                <text
                  x={b.lam < 5 ? x + 6 : x - 6}
                  y={yLabel}
                  textAnchor={b.lam < 5 ? 'start' : 'end'}
                  fill={b.color}
                  className="font-mono text-xs"
                >
                  {b.label}
                </text>
              </g>
            );
          })}

          <path d={bgPath} fill="none" stroke={SENSOR_COLOR.viirs} strokeWidth="2.2" />
          <path d={firePath} fill="none" stroke={SENSOR_COLOR.modis} strokeWidth="2.5" />

          {[2, 4, 6, 8, 10, 12, 14].map((tick) => {
            const x = lamToX(tick, w, padX);
            return (
              <text key={tick} x={x} y={h - padY + 18} textAnchor="middle" className="fill-ink-mute font-mono text-xs">
                {tick} µm
              </text>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-mute">{t('trans.wien_caption')}</p>
    </div>
  );
}

export function Transparency() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const monthly = useCalendar('month');
  const alertQ = useQuery({
    queryKey: ['alerts', aoi.id],
    queryFn: ({ signal }) => api.alerts(aoi.id, signal),
  });

  const meta = monthly.data?.response.meta;
  const alert = alertQ.data;

  return (
    <section id="transparency" className="section" aria-labelledby="transparency-title">
      <SectionHeading
        id="transparency-title"
        eyebrow={t('trans.eyebrow')}
        title={t('trans.title')}
        lead={t('trans.lead', { aoi: aoi.name })}
      />

      {/* Lead with the live audit as 4 big numbers in a row */}
      <div className="mb-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pb-4">
          <h3 className="text-base font-semibold text-ink">
            {t('trans.live_title')} <span className="font-display text-lg font-normal">{aoi.name}</span>
          </h3>
          {meta?.dataset && (
            <span className="chip">
              {DATASET_LABEL[meta.dataset] ? t(DATASET_LABEL[meta.dataset]) : meta.dataset}
            </span>
          )}
        </div>
        <dl className="grid gap-6 border-y border-line py-6 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-mute">{t('trans.live_ratio')}</dt>
            <dd className="data mt-2 text-2xl font-semibold text-ink sm:text-3xl">
              {meta?.ratio != null ? fmtRatio(meta.ratio, lang, 3) : '—'}
            </dd>
            <dd className="data mt-1 text-xs text-ink-dim">
              {meta?.overlapMonths != null
                ? meta.overlapMonths === 0
                  ? t('trans.no_overlap')
                  : meta.overlapMonths === 1
                    ? t('trans.overlap_1')
                    : t('trans.overlap_n', { n: fmtInt(meta.overlapMonths, lang) })
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-mute">{t('trans.live_z')}</dt>
            <dd className="data mt-2 text-2xl font-semibold text-ink sm:text-3xl">
              {alert ? fmtSigma(alert.z_score, lang, 2) : '—'}
            </dd>
            <dd className="data mt-1 text-xs text-ink-dim">
              {alert ? t('trans.robust_z_eq', { val: fmtSigned(alert.robust_z, lang, 2) }) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-mute">{t('trans.live_clim')}</dt>
            <dd className="data mt-2 text-2xl font-semibold text-ink sm:text-3xl">
              {alert ? fmtInt(Math.round(alert.climatology_median), lang) : '—'}
              {alert && <span className="ml-1.5 text-xs font-normal text-ink-dim">{t('trans.modis_eq')}</span>}
            </dd>
            <dd className="data mt-1 text-xs text-ink-dim">
              {alert
                ? `${t('trans.iqr_label')} ${fmtInt(Math.round(alert.climatology_q25), lang)}–${fmtInt(Math.round(alert.climatology_q75), lang)} · p90 ${fmtInt(Math.round(alert.climatology_p90), lang)}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-mute">{t('trans.live_oni')}</dt>
            <dd className="data mt-2 text-2xl font-semibold text-ink sm:text-3xl">
              {alert ? t(`enso.phase_${alert.enso_phase}` as Key) : '—'}
              {alert?.oni_value != null && (
                <span className="ml-1.5 text-sm font-normal text-ink-dim">({fmtTempC(alert.oni_value, lang, 2)})</span>
              )}
            </dd>
            <dd className="data mt-1 text-xs text-ink-dim">
              {alert
                ? t('trans.persist_status', {
                    count:
                      alert.persistence_months === 1
                        ? t('anom.alert_month_1')
                        : t('anom.alert_months_n', { n: fmtInt(alert.persistence_months, lang) }),
                    trend: t(`anom.alert_trend_${alert.trend_direction}` as Key),
                  })
                : '—'}
            </dd>
          </div>
        </dl>
      </div>

      {/* Planck Radiative Physics chart */}
      <PlanckWienDiagram />

      {/* Method items as a clean accordion (first one open, thin dividers, no boxes) */}
      <div className="mt-10 divide-y divide-line border-y border-line">
        {METHOD_ITEMS.map((c, idx) => (
          <details key={c.n} open={idx === 0} className="group py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-1 text-left [&::-webkit-details-marker]:hidden">
              <span className="flex items-baseline gap-3">
                <span className="data text-xs text-ink-mute">{c.n}</span>
                <span className="text-base font-semibold text-ink sm:text-lg">{t(c.title).replace(/^\d+\.\s*/, '')}</span>
              </span>
              <span aria-hidden className="shrink-0 text-sm text-ink-mute transition-transform duration-200 group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-3 space-y-3 sm:pl-7">
              <p className="text-sm leading-relaxed text-ink-dim">{t(c.body)}</p>
              {c.eq && (
                <p className="data overflow-x-auto rounded-lg border border-line bg-cream-deep/70 p-3 text-xs leading-relaxed text-ink">
                  {t(c.eq)}
                </p>
              )}
            </div>
          </details>
        ))}
      </div>

      {/* GOES-16 / 18 / 19 ABI & NASA FIRMS Sensor Table */}
      <article className="panel mt-10 p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-ink">{t('trans.goes_title')}</h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-dim">{t('trans.goes_lead')}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wider text-ink-mute">
                <th className="py-2 pr-4">{t('trans.goes_col_sensor')}</th>
                <th className="py-2 pr-4">{t('trans.goes_col_band')}</th>
                <th className="py-2 pr-4">{t('trans.goes_col_res')}</th>
                <th className="py-2">{t('trans.goes_col_role')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 text-ink-dim">
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-modis">MODIS Terra / Aqua (MCD14ML)</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r1_band')}</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r1_res')}</td>
                <td className="min-w-[16rem] whitespace-normal py-2.5">{t('trans.goes_r1_role')}</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-viirs">VIIRS S-NPP / NOAA-20 / NOAA-21</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r2_band')}</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r2_res')}</td>
                <td className="min-w-[16rem] whitespace-normal py-2.5">{t('trans.goes_r2_role')}</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-sev-normal">{t('trans.goes_r3_name')}</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r3_band')}</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r3_res')}</td>
                <td className="min-w-[16rem] whitespace-normal py-2.5">{t('trans.goes_r3_role')}</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-semibold text-sev-watch">{t('trans.goes_r4_name')}</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r4_band')}</td>
                <td className="data whitespace-nowrap py-2.5 pr-4">{t('trans.goes_r4_res')}</td>
                <td className="min-w-[16rem] whitespace-normal py-2.5">{t('trans.goes_r4_role')}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
