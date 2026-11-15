import { useT, type Key } from '@/app/i18n';
import { Reveal, SectionHeading } from '@/components/ui';
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

      <svg viewBox="0 0 880 250" className="hidden w-full sm:block" role="img" aria-label={t('method.diagram_aria')}>
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L8 4L0 8z" fill={CHART.axis} />
          </marker>
        </defs>
        {/* sensor lanes */}
        <rect x="4" y="22" width="200" height="78" rx="10" className={box} stroke={CHART.grid} />
        <rect x="4" y="22" width="5" height="78" rx="2" fill={SENSOR_COLOR.modis} />
        <text x="22" y="50" className={txt}>MODIS · 1 km</text>
        <text x="22" y="69" className={sub}>Terra 2000– · Aqua 2002–</text>
        <text x="22" y="85" className={sub}>MCD14DL / MCD14ML</text>

        <rect x="4" y="150" width="200" height="78" rx="10" className={box} stroke={CHART.grid} />
        <rect x="4" y="150" width="5" height="78" rx="2" fill={SENSOR_COLOR.viirs} />
        <text x="22" y="178" className={txt}>VIIRS · 375 m</text>
        <text x="22" y="197" className={sub}>S-NPP 2012– · NOAA-20/21</text>
        <text x="22" y="213" className={sub}>VNP14IMG / VJ114IMG</text>

        {stages.map((st, i) => {
          const x = 236 + i * 150;
          return (
            <g key={st.title}>
              <rect x={x} y="86" width="124" height="78" rx="10" className={box} stroke={CHART.grid} />
              <text x={x + 62} y="114" textAnchor="middle" className={txt}>{t(st.title)}</text>
              <text y="134" textAnchor="middle" className={sub}>
                {t(st.sub).split(' · ').map((line, j) => (
                  <tspan key={j} x={x + 62} dy={j ? 16 : 0}>{line}</tspan>
                ))}
              </text>
              {i < 2 && <path d={`M${x + 124} 125H${x + 148}`} stroke={CHART.axis} strokeWidth="1.5" markerEnd="url(#arr)" />}
            </g>
          );
        })}
        <path d="M204 61C222 61 214 110 234 112" fill="none" stroke={CHART.axis} strokeWidth="1.5" markerEnd="url(#arr)" />
        <path d="M204 189C222 189 214 140 234 138" fill="none" stroke={CHART.axis} strokeWidth="1.5" markerEnd="url(#arr)" />
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

      <Reveal>
        <div className="panel p-4 sm:p-6 lg:p-8">
          <Diagram />
        </div>
      </Reveal>

      {/* the five steps as editorial rows: number · title · explanation */}
      <ol className="mt-14 border-t border-line lg:mt-20">
        {STEPS.map((s, i) => (
          <li key={s.n} className="border-b border-line">
            <Reveal delay={i * 60} className="grid gap-x-8 gap-y-2 py-6 sm:grid-cols-[4.5rem_1fr] lg:grid-cols-[6rem_16rem_1fr] lg:py-8">
              <span aria-hidden className="font-display text-4xl font-light leading-none text-accent lg:text-5xl">
                {s.n}
              </span>
              <h3 className="text-xl font-semibold leading-snug text-ink sm:col-start-2 lg:col-start-auto lg:text-2xl">{t(s.title)}</h3>
              <p className="max-w-2xl text-[15px] leading-relaxed text-ink-dim sm:col-start-2 lg:col-start-auto">{t(s.body)}</p>
            </Reveal>
          </li>
        ))}
      </ol>

      {/* uncertainty in plain words; the formulas live (folded) in the transparency section */}
      <Reveal className="mt-14 lg:mt-20">
        <article className="panel grid grid-cols-1 gap-6 p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12 lg:p-10">
          <div className="min-w-0 max-w-3xl">
            <h3 className="font-display text-3xl font-light leading-tight text-cream sm:text-4xl">{t('method.unc_title')}</h3>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-dim">{t('method.unc_body')}</p>
          </div>
          <a href="#transparency-method" className="btn shrink-0 self-start lg:self-end">
            <span aria-hidden className="font-display text-base">∑</span>
            {t('method.to_formulas')}
            <span aria-hidden>→</span>
          </a>
        </article>
      </Reveal>

      {/* limitations: six short cards */}
      <div className="mt-14 lg:mt-20">
        <Reveal className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
          <h3 className="font-display text-3xl font-light text-ink sm:text-4xl">{t('method.lim_title')}</h3>
          <span className="data text-sm text-ink-mute">{String(LIMITS.length).padStart(2, '0')}</span>
        </Reveal>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {LIMITS.map((k, i) => (
            <li key={k}>
              <Reveal delay={(i % 3) * 80} className="h-full">
                <div className="h-full rounded-2xl border border-line bg-cream-deep/60 p-5 transition-colors duration-300 hover:bg-cream-deep">
                  <span className="data inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />L{i + 1}
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-ink-dim">{t(k)}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
