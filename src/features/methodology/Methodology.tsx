import { useT, type Key } from '@/app/i18n';
import { SectionHeading } from '@/components/ui';
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
  const box = 'fill-space-800 stroke-[rgba(148,170,220,0.3)]';
  const txt = 'fill-ink text-[13px] font-semibold';
  const sub = 'fill-ink-dim font-mono text-[10.5px]';
  return (
    <svg viewBox="0 0 880 250" className="w-full min-w-[640px]" role="img" aria-label={t('method.diagram_aria')}>
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0L8 4L0 8z" fill="#A9B4CC" />
        </marker>
      </defs>
      {/* sensor lanes */}
      <rect x="4" y="22" width="190" height="78" rx="10" className={box} />
      <rect x="4" y="22" width="5" height="78" rx="2" fill="#F57C2E" />
      <text x="22" y="50" className={txt}>MODIS · 1 km</text>
      <text x="22" y="69" className={sub}>Terra 2000– · Aqua 2002–</text>
      <text x="22" y="85" className={sub}>MCD14DL / MCD14ML</text>

      <rect x="4" y="150" width="190" height="78" rx="10" className={box} />
      <rect x="4" y="150" width="5" height="78" rx="2" fill="#3FA9F5" />
      <text x="22" y="178" className={txt}>VIIRS · 375 m</text>
      <text x="22" y="197" className={sub}>S-NPP 2012– · NOAA-20/21</text>
      <text x="22" y="213" className={sub}>VNP14IMG / VJ114IMG</text>

      {[0, 1, 2].map((i) => {
        const x = 236 + i * 150;
        const keys: Key[] = ['method.d_qc', 'method.d_grid', 'method.d_cal'];
        const subs: Key[] = ['method.d_qc_s', 'method.d_grid_s', 'method.d_cal_s'];
        return (
          <g key={i}>
            <rect x={x} y="86" width="124" height="78" rx="10" className={box} />
            <text x={x + 62} y="120" textAnchor="middle" className={txt}>{t(keys[i])}</text>
            <text x={x + 62} y="140" textAnchor="middle" className={sub}>{t(subs[i])}</text>
            {i < 2 && <path d={`M${x + 124} 125H${x + 148}`} stroke="#A9B4CC" strokeWidth="1.5" markerEnd="url(#arr)" />}
          </g>
        );
      })}
      <path d="M194 61C218 61 212 110 234 112" fill="none" stroke="#A9B4CC" strokeWidth="1.5" markerEnd="url(#arr)" />
      <path d="M194 189C218 189 212 140 234 138" fill="none" stroke="#A9B4CC" strokeWidth="1.5" markerEnd="url(#arr)" />
      <path d="M660 125H690" stroke="#A9B4CC" strokeWidth="1.5" markerEnd="url(#arr)" />

      <rect x="692" y="70" width="184" height="110" rx="10" className="fill-space-700 stroke-harmonized" strokeWidth="1.5" />
      <text x="784" y="104" textAnchor="middle" className={txt}>{t('method.d_out')}</text>
      <text x="784" y="126" textAnchor="middle" className={sub}>{t('method.d_out_s1')}</text>
      <text x="784" y="143" textAnchor="middle" className={sub}>{t('method.d_out_s2')}</text>
      <text x="784" y="160" textAnchor="middle" className={sub}>{t('method.d_out_s3')}</text>
    </svg>
  );
}

export function Methodology() {
  const t = useT();
  return (
    <section id="method" className="section" aria-labelledby="method-title">
      <SectionHeading id="method-title" eyebrow={t('method.eyebrow')} title={t('method.title')} lead={t('method.lead')} />
      {USE_MOCKS && (
        <p role="note" className="panel mb-5 border-harmonized/50 p-3 text-sm text-ink">
          <strong className="font-semibold">{t('header.mock')}.</strong> {t('method.mock_note')}
        </p>
      )}
      <div className="panel overflow-x-auto p-4 sm:p-5">
        <Diagram />
      </div>
      <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((s) => (
          <li key={s.n} className="panel p-4">
            <span className="data text-xs text-brand-yonder">{s.n}</span>
            <h3 className="mt-1 text-base font-semibold">{t(s.title)}</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-dim">{t(s.body)}</p>
          </li>
        ))}
      </ol>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <article className="panel p-4 sm:p-5">
          <h3 className="text-lg font-semibold">{t('method.unc_title')}</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">{t('method.unc_body')}</p>
          <p className="data mt-3 rounded-md bg-space-900/80 p-3 text-xs leading-relaxed text-ink">
            H = Σ wᵢ·Êᵢ / Σ wᵢ, &nbsp; wᵢ = 1 / Var(Êᵢ)
            <br />
            Ê_MODIS = N_MODIS / c(t) &nbsp;·&nbsp; Ê_VIIRS = N_VIIRS / (k · n(t))
            <br />
            z = (log(1 + H) − μ_doy) / σ_doy
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-mute">{t('method.unc_legend')}</p>
        </article>
        <article className="panel p-4 sm:p-5">
          <h3 className="text-lg font-semibold">{t('method.lim_title')}</h3>
          <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-dim">
            {LIMITS.map((k) => (
              <li key={k} className="flex gap-2">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-mute" />
                <span>{t(k)}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
