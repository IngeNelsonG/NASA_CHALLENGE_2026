import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { useT, type Key } from '@/app/i18n';
import { useCalendar } from '@/app/loaders';
import { Formula, Frac, Fn, Op, Paren, Sub, Sup, V } from '@/components/math';
import { Reveal, SectionHeading } from '@/components/ui';
import { isEnsoRelevantAoi } from '@/features/anomalies/alertMeta';
import { api } from '@/lib/api';
import { CHART, SENSOR_COLOR, SEV_COLOR } from '@/lib/colors';
import { fmtDec, fmtInt, fmtRatio, fmtSigma, fmtSigned, fmtTempC } from '@/lib/format';
import { useAoiName, useStore } from '@/store';

const DATASET_LABEL: Record<string, Key> = {
  'firms-archive': 'trans.dataset_firms_archive',
  'firms-global-monthly': 'trans.dataset_firms_global',
  'synthetic-sample': 'trans.dataset_synthetic',
};

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
    <div className="panel p-5 sm:p-7 lg:p-8">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-2xl">
          <h3 className="font-display text-2xl font-light leading-tight text-cream sm:text-3xl">{t('trans.wien_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">{t('trans.wien_lead')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-ink-dim">
          <span className="flex items-center gap-1.5">
            <i aria-hidden className="inline-block h-0.5 w-4 bg-modis" /> 800 K · <V>λ</V>
            <Sub>max</Sub> = {fmtDec(3.62, lang, 2)} µm
          </span>
          <span className="flex items-center gap-1.5">
            <i aria-hidden className="inline-block h-0.5 w-4 bg-viirs" /> 300 K · <V>λ</V>
            <Sub>max</Sub> = {fmtDec(9.66, lang, 2)} µm
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[540px]" role="img" aria-label={t('trans.wien_title')}>
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
                <text x={b.lam < 5 ? x + 6 : x - 6} y={yLabel} textAnchor={b.lam < 5 ? 'start' : 'end'} fill={b.color} className="font-mono text-xs">
                  {b.label}
                </text>
              </g>
            );
          })}

          <path d={bgPath} fill="none" stroke={SENSOR_COLOR.viirs} strokeWidth="2" />
          <path d={firePath} fill="none" stroke={SENSOR_COLOR.modis} strokeWidth="2" />

          {[2, 4, 6, 8, 10, 12, 14].map((tick) => (
            <text key={tick} x={lamToX(tick, w, padX)} y={h - padY + 18} textAnchor="middle" className="fill-ink-mute font-mono text-xs">
              {tick} µm
            </text>
          ))}
        </svg>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-mute">{t('trans.wien_caption')}</p>
    </div>
  );
}

/* ---- formulas, typeset (language-independent) ---- */

const s = (base: ReactNode, sub: ReactNode) => (
  <>
    <V>{base}</V>
    <Sub>{sub}</Sub>
  </>
);

const F_PLANCK = (
  <>
    <V>B</V>(<V>λ</V>, <V>T</V>)<Op>=</Op>
    <Frac
      n={
        <>
          2<V>hc</V>
          <Sup>2</Sup>
        </>
      }
      d={
        <>
          <V>λ</V>
          <Sup>5</Sup>
        </>
      }
    />
    <Op>·</Op>
    <Frac
      n="1"
      d={
        <>
          <V>e</V>
          <Sup>
            <V>hc</V> / <V>λ</V>
            <V>k</V>
            <Sub>B</Sub>
            <V>T</V>
          </Sup>
          <Op>−</Op>1
        </>
      }
    />
  </>
);
const F_WIEN = (
  <>
    {s('λ', 'max')}
    <Op>=</Op>
    <Frac n="2897.8 µm·K" d={<V>T</V>} />
  </>
);
const F_FRP = (
  <>
    <V>FRP</V>
    <Op>=</Op>
    <Frac n={<V>σ</V>} d={<V>a</V>} />
    <Fn>Σ</Fn>
    <Paren>
      {s('L', 'MIR')}
      <Op>−</Op>
      {s('L', 'bg')}
    </Paren>
  </>
);
const F_SHRINK = (
  <>
    <V>w</V>
    <Op>=</Op>
    <Frac n={<V>n</V>} d={<>
      <V>n</V> + 24
    </>} />
    <span className="mx-3 text-ink-mute">,</span>
    {s('k', 'post')}
    <Op>=</Op>
    <V>w</V> {s('k', 'obs')}
    <Op>+</Op>
    <Paren>
      1<Op>−</Op>
      <V>w</V>
    </Paren>
    {s('k', 'prior')}
  </>
);
const F_BLEND = (
  <>
    <V>H</V>
    <Op>=</Op>
    <Frac
      n={
        <>
          {s('w', 'M')} <V>M</V>
          <Op>+</Op>
          {s('w', 'V')} <V>V</V> / <V>k</V>
        </>
      }
      d={
        <>
          {s('w', 'M')}
          <Op>+</Op>
          {s('w', 'V')}
        </>
      }
    />
  </>
);
const F_LOG = (
  <>
    <V>Y</V>(<V>t</V>)<Op>=</Op>
    <Fn>ln</Fn>
    <Paren>
      1<Op>+</Op>
      <V>H</V>(<V>t</V>)
    </Paren>
  </>
);
const F_Z = (
  <>
    <V>z</V>(<V>t</V>)<Op>=</Op>
    <Frac
      n={
        <>
          <V>Y</V>(<V>t</V>)<Op>−</Op>
          {s('μ', 's')}(<V>m</V>)
        </>
      }
      d={
        <>
          <Fn>max</Fn>({s('σ', 's')}(<V>m</V>), 0.25)
        </>
      }
    />
  </>
);
const F_MAD = (
  <>
    {s('MAD', 'm')}
    <Op>=</Op>1.4826<Op>·</Op>
    <Fn>median</Fn>
    <span className="mx-[0.15em]">|</span>
    <V>X</V>
    <Op>−</Op>
    {s('M', 'm')}
    <span className="mx-[0.15em]">|</span>
  </>
);
const F_ROBUST = (
  <>
    {s('z', 'rob')}
    <Op>=</Op>
    <Frac
      n={
        <>
          <V>X</V>
          <Op>−</Op>
          {s('M', 'm')}
        </>
      }
      d={
        <>
          <Fn>max</Fn>({s('MAD', 'm')}, <V>IQR</V> / 1.349, 1)
        </>
      }
    />
  </>
);

/** Step 5 as a readable rule: two groups of conditions, both needed for CRITICAL. */
function DecisionRule() {
  const t = useT();
  const group = (title: Key, items: ReactNode[]) => (
    <div className="min-w-0 flex-1 rounded-xl border border-white/10 bg-graphite-950/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">{t(title)}</p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <li key={i} className="rounded-full border border-line bg-graphite-800 px-2.5 py-1 text-xs text-ink">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div role="group" aria-label={t('trans.s5_t')}>
      <div className="flex flex-col items-stretch gap-2">
        {group('trans.rule_int', [
          <>
            <V>z</V> ≥ 2.5
          </>,
          t('trans.c_ratio'),
          t('trans.c_nrt'),
        ])}
        <span aria-hidden className="self-center font-display text-xl leading-none text-ink-mute">∧</span>
        {group('trans.rule_ctx', [t('trans.c_persist'), t('trans.c_accel'), t('trans.c_unseasonal'), t('trans.c_nino')])}
      </div>
      <p className="mt-3 flex items-center gap-2 text-xs font-semibold text-ink">
        <i aria-hidden className="h-2 w-2 rounded-full" style={{ background: SEV_COLOR.critical }} />
        {t('trans.rule_then')}
      </p>
    </div>
  );
}

const METHOD_ITEMS: { n: string; title: Key; body: Key; formulas?: { label: string; node: ReactNode }[]; extra?: 'rule' }[] = [
  {
    n: '01',
    title: 'trans.s1_t',
    body: 'trans.s1_b',
    formulas: [
      { label: 'B(λ,T) = (2hc²/λ⁵) / (exp(hc/λk_B T) − 1)', node: F_PLANCK },
      { label: 'λ_max = 2897.8 µm·K / T', node: F_WIEN },
      { label: 'FRP = (σ/a) Σ (L_MIR − L_bg)', node: F_FRP },
    ],
  },
  {
    n: '02',
    title: 'trans.s2_t',
    body: 'trans.s2_b',
    formulas: [
      { label: 'w = n/(n+24), k_post = w k_obs + (1−w) k_prior', node: F_SHRINK },
      { label: 'H = (w_M M + w_V V/k) / (w_M + w_V)', node: F_BLEND },
    ],
  },
  {
    n: '03',
    title: 'trans.s3_t',
    body: 'trans.s3_b',
    formulas: [
      { label: 'Y(t) = ln(1 + H(t))', node: F_LOG },
      { label: 'z(t) = (Y(t) − μ_s(m)) / max(σ_s(m), 0.25)', node: F_Z },
    ],
  },
  {
    n: '04',
    title: 'trans.s4_t',
    body: 'trans.s4_b',
    formulas: [
      { label: 'MAD_m = 1.4826 median|X − M_m|', node: F_MAD },
      { label: 'z_rob = (X − M_m) / max(MAD_m, IQR/1.349, 1)', node: F_ROBUST },
    ],
  },
  { n: '05', title: 'trans.s5_t', body: 'trans.s5_b', extra: 'rule' },
  { n: '06', title: 'trans.life_title', body: 'trans.life_b' },
];

/** Folded detail under a method card: closed by default so the section reads as text first. */
function Fold({ label, count, children }: { label: string; count?: number; children: ReactNode }) {
  return (
    <details className="group/fold mt-5 rounded-xl border border-line transition-colors open:bg-graphite-950/40">
      <summary className="tap flex cursor-pointer list-none items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-white/[0.04] [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="font-display text-base leading-none text-accent">
          ∑
        </span>
        {label}
        {count != null && <span className="data rounded-full border border-line px-1.5 text-[11px] font-normal leading-4 text-ink-mute">{count}</span>}
        <span aria-hidden className="ml-auto text-xs text-ink-mute transition-transform duration-300 group-open/fold:rotate-180">
          ▾
        </span>
      </summary>
      <div className="fade-in px-3 pb-3 sm:px-4 sm:pb-4">{children}</div>
    </details>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <div className="panel flex flex-col p-5 sm:p-6">
      <dt className="text-xs leading-snug text-ink-dim">{label}</dt>
      <dd className="data mt-4 text-3xl font-semibold leading-none text-cream">{value}</dd>
      <dd className="data mt-3 border-t border-line pt-3 text-xs leading-relaxed text-ink-mute">{sub}</dd>
    </div>
  );
}

export function Transparency() {
  const t = useT();
  const lang = useStore((st) => st.lang);
  const aoi = useStore((st) => st.aoi);
  const aoiName = useAoiName();
  const monthly = useCalendar('month');
  const alertQ = useQuery({
    queryKey: ['alerts', aoi.id],
    queryFn: ({ signal }) => api.alerts(aoi.id, signal),
  });

  const meta = monthly.data?.response.meta;
  const alert = alertQ.data;
  const showEnso = isEnsoRelevantAoi(aoi, alert);

  return (
    <section id="transparency" className="section" aria-labelledby="transparency-title">
      <SectionHeading id="transparency-title" eyebrow={t('trans.eyebrow')} title={t('trans.title')} lead={t('trans.lead', { aoi: aoiName })} />

      {/* live audit for the selected area */}
      <Reveal>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-semibold text-ink">
            <span className="chip !border-sev-normal/60 !bg-graphite-800 !text-cream">
              <span aria-hidden className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sev-normal opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-sev-normal" />
              </span>
              {t('trans.live_badge')}
            </span>
            {t('trans.live_title')} <span className="font-display text-xl font-normal">{aoiName}</span>
          </h3>
          {meta?.dataset && <span className="chip">{DATASET_LABEL[meta.dataset] ? t(DATASET_LABEL[meta.dataset]) : meta.dataset}</span>}
        </div>
      </Reveal>
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('trans.live_ratio')}
          value={meta?.ratio != null ? fmtRatio(meta.ratio, lang, 3) : '—'}
          sub={
            meta?.overlapMonths != null
              ? meta.overlapMonths === 0
                ? t('trans.no_overlap')
                : meta.overlapMonths === 1
                  ? t('trans.overlap_1')
                  : t('trans.overlap_n', { n: fmtInt(meta.overlapMonths, lang) })
              : '—'
          }
        />
        <Stat
          label={t('trans.live_z')}
          value={alert ? fmtSigma(alert.z_score, lang, 2) : '—'}
          sub={alert ? t('trans.robust_z_eq', { val: fmtSigned(alert.robust_z, lang, 2) }) : '—'}
        />
        <Stat
          label={t('trans.live_clim')}
          value={
            alert ? (
              <>
                {fmtInt(Math.round(alert.climatology_median), lang)}
                <span className="ml-1.5 text-xs font-normal text-ink-dim">{t('trans.modis_eq')}</span>
              </>
            ) : (
              '—'
            )
          }
          sub={
            alert
              ? `${t('trans.iqr_label')} ${fmtInt(Math.round(alert.climatology_q25), lang)}–${fmtInt(Math.round(alert.climatology_q75), lang)} · p90 ${fmtInt(Math.round(alert.climatology_p90), lang)}`
              : '—'
          }
        />
        <Stat
          label={t('trans.live_oni')}
          value={
            !showEnso ? (
              <span className="block font-sans text-base font-medium leading-snug text-ink-dim">{t('trans.enso_na')}</span>
            ) : alert ? (
              <>
                {t(`enso.phase_${alert.enso_phase}` as Key)}
                {alert.oni_value != null && <span className="ml-1.5 text-sm font-normal text-ink-dim">({fmtTempC(alert.oni_value, lang, 2)})</span>}
              </>
            ) : (
              '—'
            )
          }
          sub={
            alert
              ? t('trans.persist_status', {
                  count: alert.persistence_months === 1 ? t('anom.alert_month_1') : t('anom.alert_months_n', { n: fmtInt(alert.persistence_months, lang) }),
                  trend: t(`anom.alert_trend_${alert.trend_direction}` as Key),
                })
              : '—'
          }
        />
      </dl>

      <div className="mt-12 lg:mt-16">
        <Reveal>
          <PlanckWienDiagram />
        </Reveal>
      </div>

      {/* the method, step by step: the idea in words, its formulas folded underneath */}
      <div id="transparency-method" className="mt-14 scroll-mt-6 lg:mt-20">
        <Reveal className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
          <h3 className="font-display text-3xl font-light text-ink sm:text-4xl">{t('trans.method_title')}</h3>
          <span className="data text-sm text-ink-mute">{String(METHOD_ITEMS.length).padStart(2, '0')}</span>
        </Reveal>
        <ol className="mt-6 grid grid-cols-1 items-start gap-4 lg:grid-cols-2 lg:gap-5">
          {METHOD_ITEMS.map((c, i) => (
            <li key={c.n}>
              <Reveal delay={(i % 2) * 90}>
                <article className="panel flex flex-col p-5 sm:p-7">
                  <header className="flex items-baseline gap-4">
                    <span aria-hidden className="font-display text-3xl font-light leading-none text-accent">
                      {c.n}
                    </span>
                    <h4 className="text-lg font-semibold leading-snug text-cream">{t(c.title).replace(/^\d+\.\s*/, '')}</h4>
                  </header>
                  <p className="mt-3 text-sm leading-relaxed text-ink-dim">{t(c.body)}</p>
                  {c.formulas && (
                    <Fold label={t('trans.formulas')} count={c.formulas.length}>
                      <div className="flex flex-col gap-2.5">
                        {c.formulas.map((f) => (
                          <Formula key={f.label} label={f.label}>
                            {f.node}
                          </Formula>
                        ))}
                      </div>
                    </Fold>
                  )}
                  {c.extra === 'rule' && (
                    <Fold label={t('trans.rule')}>
                      <DecisionRule />
                    </Fold>
                  )}
                </article>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>

      {/* GOES-16 / 18 / 19 ABI & NASA FIRMS sensor table */}
      <Reveal className="mt-14 lg:mt-20">
        <article className="panel p-5 sm:p-7">
          <h3 className="font-display text-2xl font-light leading-tight text-cream sm:text-3xl">{t('trans.goes_title')}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-dim">{t('trans.goes_lead')}</p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wider text-ink-mute">
                  <th className="py-2.5 pr-4 font-semibold">{t('trans.goes_col_sensor')}</th>
                  <th className="py-2.5 pr-4 font-semibold">{t('trans.goes_col_band')}</th>
                  <th className="py-2.5 pr-4 font-semibold">{t('trans.goes_col_res')}</th>
                  <th className="py-2.5 font-semibold">{t('trans.goes_col_role')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-dim">
                {(
                  [
                    { name: 'MODIS Terra / Aqua (MCD14ML)', color: SENSOR_COLOR.modis, k: 'r1' },
                    { name: 'VIIRS S-NPP / NOAA-20 / NOAA-21', color: SENSOR_COLOR.viirs, k: 'r2' },
                    { name: t('trans.goes_r3_name'), color: SEV_COLOR.normal, k: 'r3' },
                    { name: t('trans.goes_r4_name'), color: SEV_COLOR.watch, k: 'r4' },
                  ] as const
                ).map((r) => (
                  <tr key={r.k} className="align-top">
                    <td className="py-3 pr-4 font-semibold text-ink">
                      <span className="flex items-start gap-2">
                        <i aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
                        {r.name}
                      </span>
                    </td>
                    <td className="data whitespace-nowrap py-3 pr-4">{t(`trans.goes_${r.k}_band` as Key)}</td>
                    <td className="data whitespace-nowrap py-3 pr-4">{t(`trans.goes_${r.k}_res` as Key)}</td>
                    <td className="min-w-[16rem] py-3">{t(`trans.goes_${r.k}_role` as Key)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </Reveal>
    </section>
  );
}
