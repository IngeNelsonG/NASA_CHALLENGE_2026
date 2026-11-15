import { useT } from '@/app/i18n';
import type { AlertAssessment } from '@/lib/types';
import { severityStyle } from './alertMeta';

const LEVELS: readonly AlertAssessment['severity'][] = ['NORMAL', 'WATCH', 'WARNING', 'CRITICAL'];
const METRICS = ['ratio', 'sigma', 'persist', 'nrt'] as const;

/** Plain-language legend rendered directly on the editorial cream surface. */
export function WarningGuideCard() {
  const t = useT();

  return (
    <div id="alert-guide" className="mt-10 border-t border-line pt-8" aria-labelledby="alert-guide-title">
      <div className="max-w-2xl">
        <h4 id="alert-guide-title" className="text-lg font-semibold text-ink sm:text-xl">
          {t('anom.guide_title')}
        </h4>
        <p className="mt-1 text-sm leading-relaxed text-ink-dim">{t('anom.guide_lead')}</p>
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div>
          <p className="eyebrow">{t('anom.guide_levels_title')}</p>
          <ul className="mt-3 divide-y divide-line/60 border-t border-line/60">
            {LEVELS.map((sev) => {
              const st = severityStyle(sev);
              return (
                <li key={sev} className="py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <i aria-hidden className={`h-2.5 w-2.5 rounded-full ring-1 ring-ink/15 ${st.dot}`} />
                    <span aria-hidden className="text-xs leading-none">
                      {st.symbol}
                    </span>
                    <span>{t(`anom.guide_lv_${sev}_t`)}</span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-dim">
                    {t(`anom.guide_lv_${sev}_b`)}
                  </p>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="eyebrow">{t('anom.guide_metrics_title')}</p>
          <dl className="mt-3 divide-y divide-line/60 border-t border-line/60">
            {METRICS.map((m) => (
              <div key={m} className="py-3">
                <dt className="text-sm font-semibold text-ink">{t(`anom.guide_m_${m}_t`)}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink-dim">
                  {t(`anom.guide_m_${m}_b`)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
