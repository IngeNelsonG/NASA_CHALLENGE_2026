import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fmtInt, fmtMonth, monthName, useT } from '@/app/i18n';
import { useCalendar } from '@/app/loaders';
import { SectionHeading, Spinner } from '@/components/ui';
import { fireColor } from '@/lib/colors';
import { api } from '@/lib/api';
import { useStore } from '@/store';

const HOT = '#F2703A';
const COOL = '#4C9BE8';

export function Anomalies() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const q = useQuery({ queryKey: ['anomalies', aoi.id], queryFn: ({ signal }) => api.anomalies(aoi.id, signal) });
  const monthly = useCalendar('month');

  // Typical critical season from the monthly climatology: months above half of the peak month.
  const season = useMemo(() => {
    const clim = monthly.data?.response.aoi.id === aoi.id ? monthly.data.response.climatology : null;
    if (!clim || clim.length < 12) return null;
    const means = clim.slice(0, 12).map((c) => c.mean);
    const peak = means.indexOf(Math.max(...means));
    const total = means.reduce((a, b) => a + b, 0) || 1;
    const on = means.map((v) => v >= means[peak] * 0.5);
    let a = peak, b = peak;
    while (on[(a + 11) % 12] && (a + 11) % 12 !== b) a = (a + 11) % 12;
    while (on[(b + 1) % 12] && (b + 1) % 12 !== a) b = (b + 1) % 12;
    const inSeason = (m: number) => (a <= b ? m >= a && m <= b : m >= a || m <= b);
    const share = means.reduce((s, v, m) => s + (inSeason(m) ? v : 0), 0) / total;
    return { means, peak, a, b, inSeason, share, max: means[peak] };
  }, [monthly.data, aoi.id]);

  const list = (q.data ?? []).slice(0, 10);
  const zMax = Math.max(3, ...list.map((a) => Math.abs(a.zScore)));
  const open = (start: string) => {
    useStore.getState().set({ highlights: [{ date: start, reason: '' }] });
    useStore.getState().revealOnCalendar(start);
  };

  return (
    <section id="anomalies" className="section" aria-labelledby="anomalies-title">
      <SectionHeading id="anomalies-title" eyebrow={t('anom.eyebrow')} title={t('anom.title')} lead={t('anom.lead')} />
      <div className="grid gap-5 lg:grid-cols-[1fr_1.25fr]">
        <article className="panel p-4 sm:p-5">
          <h3 className="text-lg font-semibold">{t('anom.season_title')}</h3>
          {season ? (
            <>
              <p className="data mt-3 text-3xl text-ink">
                {monthName(season.a, lang, 'long')} – {monthName(season.b, lang, 'long')}
              </p>
              <p className="mt-1 text-sm text-ink-dim">{t('anom.season_share', { pct: Math.round(season.share * 100), peak: monthName(season.peak, lang, 'long') })}</p>
              <ol className="mt-5 grid grid-cols-12 gap-1" aria-label={t('anom.season_aria')}>
                {season.means.map((v, m) => (
                  <li key={m} className="text-center" title={`${monthName(m, lang, 'long')}: ${fmtInt(v, lang)}`}>
                    <div
                      className={`h-12 rounded-sm ${season.inSeason(m) ? 'outline outline-2 outline-offset-1 outline-white' : ''}`}
                      style={{ background: fireColor(v, season.max) }}
                    />
                    <span className={`data mt-1.5 block text-[10px] ${season.inSeason(m) ? 'font-semibold text-ink' : 'text-ink-dim'}`}>{monthName(m, lang, 'narrow')}</span>
                    <span className="sr-only">
                      {monthName(m, lang, 'long')}: {fmtInt(v, lang)}
                      {season.inSeason(m) ? ` (${t('anom.in_season')})` : ''}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-4 text-xs leading-relaxed text-ink-mute">{t('anom.season_note')}</p>
            </>
          ) : (
            <div className="grid h-40 place-items-center">
              <Spinner label={t('common.loading')} />
            </div>
          )}
        </article>

        <article className="panel p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-semibold">{t('anom.list_title')}</h3>
            <p className="flex items-center gap-3 text-xs text-ink-dim">
              <span className="flex items-center gap-1.5">
                <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COOL }} /> {t('anom.below')}
              </span>
              <span className="flex items-center gap-1.5">
                <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: HOT }} /> {t('anom.above')}
              </span>
            </p>
          </div>
          {q.isError ? (
            <p role="alert" className="mt-4 text-sm text-ink-dim">{t('common.error')}</p>
          ) : q.isPending ? (
            <div className="grid h-40 place-items-center">
              <Spinner label={t('common.loading')} />
            </div>
          ) : list.length === 0 ? (
            <p className="mt-4 text-sm text-ink-dim">{t('anom.none')}</p>
          ) : (
            <ul className="mt-3 divide-y divide-line/70">
              {list.map((a) => {
                const pos = a.zScore > 0;
                const w = (Math.abs(a.zScore) / zMax) * 50;
                const same = a.start.slice(0, 7) === a.end.slice(0, 7);
                return (
                  <li key={a.start + a.end}>
                    <button type="button" onClick={() => open(a.start)} title={a.label} className="grid w-full grid-cols-[minmax(7.5rem,auto)_1fr_auto] items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-space-700/60">
                      <span className="data text-sm text-ink">
                        {fmtMonth(a.start, lang)}
                        {!same && <> – {fmtMonth(a.end, lang)}</>}
                      </span>
                      <span aria-hidden className="relative h-3">
                        <span className="absolute inset-y-0 left-1/2 w-px bg-ink-mute" />
                        <span className="absolute inset-y-0 rounded-sm" style={pos ? { left: 'calc(50% + 1px)', width: `${w}%`, background: HOT } : { right: 'calc(50% + 1px)', width: `${w}%`, background: COOL }} />
                      </span>
                      <span className="data w-24 text-right text-sm text-ink">
                        {pos ? '+' : '−'}
                        {Math.abs(a.zScore).toFixed(1)} σ <span className="text-xs text-ink-dim">{t(pos ? 'anom.above' : 'anom.below')}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-ink-mute">{t('anom.list_note')}</p>
        </article>
      </div>
    </section>
  );
}
