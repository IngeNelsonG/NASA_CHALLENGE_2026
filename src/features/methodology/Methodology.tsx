import { useT, type Key } from '@/app/i18n';
import { SectionHeading } from '@/components/ui';
import { CHART, SENSOR_COLOR } from '@/lib/colors';
import { USE_MOCKS } from '@/lib/env';

const STEPS: { n: string; title: Key; body: Key }[] = [
  { n: '01', title: 'method.s1_t', body: 'method.s1_b' },
  { n: '02', title: 'method.s2_t', body: 'method.s2_b' },
  { n: '03', title: 'method.s3_t', body: 'method.s3_b' },
  { n: '04', title: 'method.s4_t', body: 'method.s4_b' },
  { n: '05', title: 'method.s5_t', body: 'method.s5_b' },
];
const LIMITS: Key[] = ['method.l1', 'method.l2', 'method.l3', 'method.l4', 'method.l5', 'method.l6'];

/** Pipeline diagram: two sensor lanes merge into one harmonised record. */
function Diagram() {
  const t = useT();
  const box = 'fill-graphite-800';
  const txt = 'fill-ink text-[13px] font-semibold';
  const sub = 'fill-ink-dim font-mono text-xs';
  const stages: { title: Key; sub: Key }[] = [
    { title: 'method.d_qc', sub: 'method.d_qc_s' },
    { title: 'method.d_grid', sub: 'method.d_grid_s' },
    { title: 'method.d_cal', sub: 'method.d_cal_s' },
  ];
  return (
    <>
      <div className="space-y-2.5 sm:hidden" role="img" aria-label={t('method.diagram_aria')}>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-line bg-graphite-800 p-2.5">
            <p className="text-xs font-semibold text-modis">MODIS · 1 km</p>
            <p className="data mt-0.5 text-xs text-ink-dim">Terra 2000– · Aqua 2002–</p>
          </div>
          <div className="rounded-lg border border-line bg-graphite-800 p-2.5">
            <p className="text-xs font-semibold text-viirs">VIIRS · 375 m</p>
            <p className="data mt-0.5 text-xs text-ink-dim">S-NPP 2012– · NOAA-20/21</p>
          </div>
        </div>
        {stages.map((st) => (
          <div key={st.title} className="rounded-lg border border-line bg-graphite-800 px-3 py-2">
            <p className="text-xs font-semibold text-ink">{t(st.title)}</p>
            <p className="data mt-0.5 text-xs text-ink-dim">{t(st.sub)}</p>
          </div>
        ))}
        <div className="rounded-lg border border-harmonized bg-graphite-700 px-3 py-2.5">
          <p className="text-xs font-semibold text-ink">{t('method.d_out')}</p>
          <p className="data mt-0.5 text-xs text-ink-dim">
            {t('method.d_out_s1')} · {t('method.d_out_s2')} · {t('method.d_out_s3')}
          </p>
        </div>
      </div>

      <svg
        viewBox="0 0 880 250"
        className="hidden w-full sm:block"
        role="img"
        aria-label={t('method.diagram_aria')}
      >
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4L0 8z" fill={CHART.axis} />
          </marker>
        </defs>
        {/* sensor lanes */}
        <rect x="4" y="22" width="190" height="78" rx="10" className={box} stroke={CHART.grid} />
        <rect x="4" y="22" width="5" height="78" rx="2" fill={SENSOR_COLOR.modis} />
        <text x="22" y="50" className={txt}>MODIS · 1 km</text>
        <text x="22" y="69" className={sub}>Terra 2000– · Aqua 2002–</text>
        <text x="22" y="85" className={sub}>MCD14DL / MCD14ML</text>

        <rect x="4" y="150" width="190" height="78" rx="10" className={box} stroke={CHART.grid} />
        <rect x="4" y="150" width="5" height="78" rx="2" fill={SENSOR_COLOR.viirs} />
        <text x="22" y="178" className={txt}>VIIRS · 375 m</text>
        <text x="22" y="197" className={sub}>S-NPP 2012– · NOAA-20/21</text>
        <text x="22" y="213" className={sub}>VNP14IMG / VJ114IMG</text>

        {[0, 1, 2].map((i) => {
          const x = 236 + i * 150;
          const keys: Key[] = ['method.d_qc', 'method.d_grid', 'method.d_cal'];
          const subs: Key[] = ['method.d_qc_s', 'method.d_grid_s', 'method.d_cal_s'];
          return (
            <g key={i}>
              <rect x={x} y="86" width="124" height="78" rx="10" className={box} stroke={CHART.grid} />
              <text x={x + 62} y="120" textAnchor="middle" className={txt}>{t(keys[i])}</text>
              <text x={x + 62} y="140" textAnchor="middle" className={sub}>{t(subs[i])}</text>
              {i < 2 && <path d={`M${x + 124} 125H${x + 148}`} stroke={CHART.axis} strokeWidth="1.5" markerEnd="url(#arr)" />}
            </g>
          );
        })}
        <path d="M194 61C218 61 212 110 234 112" fill="none" stroke={CHART.axis} strokeWidth="1.5" markerEnd="url(#arr)" />
        <path d="M194 189C218 189 212 140 234 138" fill="none" stroke={CHART.axis} strokeWidth="1.5" markerEnd="url(#arr)" />
        <path d="M660 125H690" stroke={CHART.axis} strokeWidth="1.5" markerEnd="url(#arr)" />

        <rect x="692" y="70" width="184" height="110" rx="10" className="fill-graphite-700 stroke-harmonized" strokeWidth="1.5" />
        <text x="784" y="104" textAnchor="middle" className={txt}>{t('method.d_out')}</text>
        <text x="784" y="126" textAnchor="middle" className={sub}>{t('method.d_out_s1')}</text>
        <text x="784" y="143" textAnchor="middle" className={sub}>{t('method.d_out_s2')}</text>
        <text x="784" y="160" textAnchor="middle" className={sub}>{t('method.d_out_s3')}</text>
      </svg>
    </>
  );
}

export function Methodology() {
  const t = useT();
  return (
    <section id="method" className="section" aria-labelledby="method-title">
      <SectionHeading id="method-title" eyebrow={t('method.eyebrow')} title={t('method.title')} lead={t('method.lead')} />
      {USE_MOCKS && (
        <p role="note" className="panel mb-5 border-0 p-3 text-sm text-ink">
          <strong className="font-semibold">{t('header.mock')}.</strong> {t('method.mock_note')}
        </p>
      )}
      <div className="panel p-4 sm:p-5">
        <Diagram />
      </div>

      {/* 5-step numbered vertical timeline (line + dots) */}
      <ol className="relative mx-auto mt-10 max-w-3xl space-y-7 pl-11 before:absolute before:bottom-3 before:left-[15px] before:top-3 before:w-px before:bg-line sm:pl-12">
        {STEPS.map((s) => (
          <li key={s.n} className="relative">
            <span
              aria-hidden
              className="data absolute -left-11 top-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-graphite-800 text-xs font-semibold text-cream sm:-left-12"
            >
              {s.n}
            </span>
            <h3 className="text-lg font-semibold text-ink">{t(s.title)}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-dim">{t(s.body)}</p>
          </li>
        ))}
      </ol>

      {/* Two calm editorial columns on lg */}
      <div className="mt-12 grid gap-10 border-t border-line pt-10 lg:grid-cols-2 lg:gap-12">
        <article className="min-w-0">
          <h3 className="text-xl font-semibold text-ink">{t('method.unc_title')}</h3>
          <p className="mt-3 text-sm leading-relaxed text-ink-dim">{t('method.unc_body')}</p>
          <details className="mt-4 text-xs">
            <summary className="cursor-pointer select-none font-semibold text-ink hover:text-ink-dim">
              {t('trans.show_formula')}
            </summary>
            <p className="data mt-3 overflow-x-auto rounded-lg border border-line bg-cream-deep/70 p-3.5 leading-relaxed text-ink">
              H = Σ wᵢ·Êᵢ / Σ wᵢ, &nbsp; wᵢ = 1 / Var(Êᵢ)
              <br />
              Ê_MODIS = N_MODIS / c(t) &nbsp;·&nbsp; Ê_VIIRS = N_VIIRS / (k · n(t))
              <br />
              z = (log(1 + H) − μ_doy) / σ_doy
            </p>
            <p className="mt-2.5 leading-relaxed text-ink-mute">{t('method.unc_legend')}</p>
          </details>
        </article>

        <article className="min-w-0">
          <h3 className="text-xl font-semibold text-ink">{t('method.lim_title')}</h3>
          <ul className="mt-3 space-y-3 text-sm leading-relaxed text-ink-dim">
            {LIMITS.map((k) => (
              <li key={k} className="flex gap-2.5">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-mute" />
                <span className="min-w-0">{t(k)}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
