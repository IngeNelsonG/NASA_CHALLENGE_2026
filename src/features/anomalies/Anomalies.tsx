import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { fmtInt, fmtMonth, monthName, useT } from '@/app/i18n';
import { useCalendar } from '@/app/loaders';
import { SectionHeading, Spinner } from '@/components/ui';
import { fireColor } from '@/lib/colors';
import { api } from '@/lib/api';
import { bboxId } from '@/lib/geo';
import type { AlertAssessment, BBox } from '@/lib/types';
import { useStore } from '@/store';

const HOT = '#F2703A';
const COOL = '#4C9BE8';

const TZ_TO_AOI: Record<string, string> = {
  'America/Bogota': 'co',
  'America/Sao_Paulo': 'country:brazil',
  'America/Manaus': 'country:brazil',
  'America/Belem': 'country:brazil',
  'America/Fortaleza': 'country:brazil',
  'America/Recife': 'country:brazil',
  'America/Cuiaba': 'country:brazil',
  'America/Boa_Vista': 'country:brazil',
  'America/Porto_Velho': 'country:brazil',
  'America/Santiago': 'country:chile',
  'America/Lima': 'country:peru',
  'America/La_Paz': 'country:bolivia',
  'America/Guayaquil': 'country:ecuador',
  'America/Caracas': 'country:venezuela',
  'America/Mexico_City': 'country:mexico',
  'America/Monterrey': 'country:mexico',
  'America/Cancun': 'country:mexico',
  'America/New_York': 'country:united-states',
  'America/Chicago': 'country:united-states',
  'America/Denver': 'country:united-states',
  'America/Los_Angeles': 'country:united-states',
  'America/Toronto': 'country:canada',
  'America/Vancouver': 'country:canada',
  'Europe/Lisbon': 'pt',
  'Europe/Madrid': 'country:spain',
  'Europe/Paris': 'country:france',
  'Africa/Lusaka': 'zm',
};

function detectVisitorAoiId(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    if (tz in TZ_TO_AOI) return TZ_TO_AOI[tz];
    if (tz.startsWith('America/Argentina/')) return 'ar';
    if (tz.startsWith('Australia/')) return 'country:australia';
    if (tz.startsWith('Asia/Jakarta') || tz.startsWith('Asia/Makassar')) return 'country:indonesia';
    const lang = (navigator.language || '').toUpperCase();
    if (lang.endsWith('-BR')) return 'country:brazil';
    if (lang.endsWith('-AR')) return 'ar';
    if (lang.endsWith('-CL')) return 'country:chile';
    if (lang.endsWith('-PE')) return 'country:peru';
    if (lang.endsWith('-MX')) return 'country:mexico';
    if (lang.endsWith('-US')) return 'country:united-states';
    if (lang.endsWith('-ES')) return 'country:spain';
    if (lang.endsWith('-PT')) return 'pt';
  } catch {
    /* fallback below */
  }
  return 'co';
}

function severityBadgeClass(sev: AlertAssessment['severity']): string {
  if (sev === 'CRITICAL') return 'border-rose-400/60 bg-rose-500/15 text-rose-200';
  if (sev === 'WARNING') return 'border-amber-400/60 bg-amber-500/15 text-amber-200';
  if (sev === 'WATCH') return 'border-yellow-400/50 bg-yellow-500/10 text-yellow-200';
  return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200';
}

async function focusAlertTerritory(item: AlertAssessment): Promise<void> {
  const q = (item.department ?? item.country ?? item.region_name).replace(/,\s*Colombia$/i, '');
  try {
    const hits = await api.searchAoi(q);
    const match = hits.find((h) => h.id === item.aoi_id) ?? hits[0];
    if (match) {
      useStore.getState().setAoi(match, true);
      return;
    }
  } catch {
    /* keep selection gracefully if offline */
  }
}

export function Anomalies() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const visitorAoiId = useMemo(detectVisitorAoiId, []);
  const [tab, setTab] = useState<'countries' | 'colombia'>(() => (visitorAoiId === 'co' ? 'colombia' : 'countries'));
  const [filterText, setFilterText] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'denied'>('idle');

  const q = useQuery({ queryKey: ['anomalies', aoi.id], queryFn: ({ signal }) => api.anomalies(aoi.id, signal) });
  const alertQ = useQuery({ queryKey: ['alerts', aoi.id], queryFn: ({ signal }) => api.alerts(aoi.id, signal) });
  const visitorQ = useQuery({
    queryKey: ['alerts', visitorAoiId],
    queryFn: ({ signal }) => api.alerts(visitorAoiId, signal),
  });
  const overviewQ = useQuery({
    queryKey: ['alerts-overview'],
    queryFn: ({ signal }) => api.alertsOverview(signal),
    staleTime: 5 * 60_000,
  });
  const monthly = useCalendar('month');

  const requestGpsLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('denied');
      return;
    }
    setGpsStatus('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsStatus('idle');
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const box: BBox = [
          Number((lon - 1).toFixed(2)),
          Number((lat - 1).toFixed(2)),
          Number((lon + 1).toFixed(2)),
          Number((lat + 1).toFixed(2)),
        ];
        useStore.getState().setAoi(
          {
            id: bboxId(box),
            name: `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'} (±1°)`,
            bbox: box,
          },
          true,
        );
      },
      () => setGpsStatus('denied'),
      { timeout: 8000 },
    );
  };

  const directoryItems = useMemo(() => {
    const raw = tab === 'countries' ? (overviewQ.data?.countries ?? []) : (overviewQ.data?.colombia ?? []);
    const needle = filterText.trim().toLowerCase();
    return raw.filter((item) => {
      if (activeOnly && item.severity === 'NORMAL') return false;
      if (!needle) return true;
      return item.region_name.toLowerCase().includes(needle) || item.aoi_id.toLowerCase().includes(needle);
    });
  }, [overviewQ.data, tab, filterText, activeOnly]);

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

      {/* Deterministic Early-Warning Alert Routing (CAP-1.2) */}
      <article className="panel mt-6 p-6">
        {visitorQ.data && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-space-800/70 px-4 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="eyebrow">{t('anom.loc_detected')}</span>
              <strong className="font-semibold text-ink">{visitorQ.data.region_name}</strong>
              <span className={`rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-medium ${severityBadgeClass(visitorQ.data.severity)}`}>
                {lang === 'es' ? visitorQ.data.severity_label_es : visitorQ.data.severity_label_en}
              </span>
              <span className="text-ink-dim">
                ({visitorQ.data.z_score >= 0 ? '+' : '−'}
                {Math.abs(visitorQ.data.z_score).toFixed(2)} σ)
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {visitorQ.data.aoi_id !== aoi.id && (
                <button
                  type="button"
                  onClick={() => void focusAlertTerritory(visitorQ.data)}
                  className="btn !min-h-[30px] text-xs"
                >
                  {t('anom.loc_fly')}
                </button>
              )}
              <button
                type="button"
                onClick={requestGpsLocation}
                disabled={gpsStatus === 'loading'}
                className="btn !min-h-[30px] text-xs"
              >
                {gpsStatus === 'loading' ? t('common.loading') : t('anom.loc_gps')}
              </button>
              {gpsStatus === 'denied' && <span className="text-[11px] text-amber-300">{t('anom.loc_gps_denied')}</span>}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow">{t('anom.alert_eyebrow')}</p>
              {alertQ.data && (
                <span className="chip text-[11px]">{alertQ.data.protocol}</span>
              )}
            </div>
            <h3 className="mt-1 font-display text-lg font-medium text-ink">
              {t('anom.alert_title')} — <span className="text-brand-yonder">{aoi.name}</span>
            </h3>
          </div>
          {alertQ.isError ? (
            <span className="text-xs text-ink-dim">{t('common.error')}</span>
          ) : alertQ.isLoading ? (
            <Spinner label={t('common.loading')} />
          ) : alertQ.data ? (
            <span
              className={`rounded-full border px-3 py-1 font-mono text-xs font-medium tracking-wider ${severityBadgeClass(alertQ.data.severity)}`}
            >
              {lang === 'es' ? alertQ.data.severity_label_es : alertQ.data.severity_label_en}
            </span>
          ) : null}
        </div>

        {alertQ.data && (
          <div className="mt-4 space-y-5">
            <div>
              <p className="text-sm font-medium text-ink">
                {lang === 'es' ? alertQ.data.headline_es : alertQ.data.headline_en}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">
                {lang === 'es' ? alertQ.data.technical_summary_es : alertQ.data.technical_summary_en}
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 text-xs">
              <span className="chip data">
                {alertQ.data.z_score >= 0 ? '+' : '−'}
                {Math.abs(alertQ.data.z_score).toFixed(2)} σ
              </span>
              <span className="chip data">
                {alertQ.data.anomaly_ratio.toFixed(2)}× {t('anom.alert_ratio')}
              </span>
              <span className="chip data">
                {t('anom.alert_persist')}: {alertQ.data.persistence_months} {t('anom.alert_months')}
              </span>
              <span className="chip">
                {t('anom.alert_trend')}: {t(`anom.alert_trend_${alertQ.data.trend_direction}`)}
              </span>
              {alertQ.data.unseasonal && (
                <span className="chip border-amber-400/40 text-amber-200">{t('anom.alert_unseasonal')}</span>
              )}
              {alertQ.data.nrt_percent_of_normal != null && (
                <span className="chip data">
                  {t('anom.alert_nrt')}: {alertQ.data.nrt_percent_of_normal.toFixed(0)} %
                </span>
              )}
            </div>

            <div className="grid gap-5 border-t border-line pt-4 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <p className="eyebrow">{t('anom.alert_authorities')}</p>
                <ul className="mt-2.5 grid gap-2 sm:grid-cols-2">
                  {alertQ.data.authorities.map((auth) => (
                    <li
                      key={auth.code}
                      className="rounded-lg border border-line/80 bg-space-800/50 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-ink">{auth.code}</span>
                        {auth.portal && (
                          <a
                            href={auth.portal}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[11px] text-amber-300 underline-offset-2 hover:underline"
                          >
                            {t('anom.alert_portal')} ↗
                          </a>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] font-medium text-ink-dim">{auth.name}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-ink-mute">
                        {lang === 'es' ? auth.role_es : auth.role_en}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lg:col-span-5">
                <p className="eyebrow">{t('anom.alert_actions')}</p>
                <ul className="mt-2.5 space-y-1.5 text-xs leading-relaxed text-ink-dim">
                  {(lang === 'es'
                    ? alertQ.data.recommended_actions_es
                    : alertQ.data.recommended_actions_en
                  ).map((step, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="font-mono text-ink-mute">{idx + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Interactive Country & Colombia Departments Alert Monitor */}
            <div className="border-t border-line pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-display text-base font-medium text-ink">{t('anom.dir_title')}</h4>
                  <p className="mt-0.5 text-xs text-ink-dim">{t('anom.dir_lead')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTab('countries')}
                    className={`btn !min-h-[32px] text-xs ${tab === 'countries' ? 'btn-primary' : ''}`}
                  >
                    {t('anom.tab_countries')} ({overviewQ.data?.countries.length ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('colombia')}
                    className={`btn !min-h-[32px] text-xs ${tab === 'colombia' ? 'btn-primary' : ''}`}
                  >
                    {t('anom.tab_colombia')} ({overviewQ.data?.colombia.length ?? 0})
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="search"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder={t('anom.filter_ph')}
                  className="input max-w-xs !py-1.5 text-xs"
                />
                <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-dim">
                  <input
                    type="checkbox"
                    checked={activeOnly}
                    onChange={(e) => setActiveOnly(e.target.checked)}
                    className="accent-modis"
                  />
                  {t('anom.active_only')}
                </label>
              </div>

              {overviewQ.isLoading ? (
                <div className="mt-4 flex justify-center">
                  <Spinner label={t('common.loading')} />
                </div>
              ) : (
                <div className="mt-3 grid max-h-80 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                  {directoryItems.map((item) => (
                    <button
                      key={item.aoi_id}
                      type="button"
                      onClick={() => void focusAlertTerritory(item)}
                      className={`rounded-lg border p-3 text-left transition-colors hover:bg-space-700/70 ${
                        item.aoi_id === aoi.id ? 'border-brand-yonder bg-space-700/60' : 'border-line/80 bg-space-800/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-ink">{item.region_name}</span>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] ${severityBadgeClass(item.severity)}`}>
                          {lang === 'es' ? item.severity_label_es : item.severity_label_en}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-dim">
                        <span>
                          {item.z_score >= 0 ? '+' : '−'}
                          {Math.abs(item.z_score).toFixed(2)} σ
                        </span>
                        <span>· {item.anomaly_ratio.toFixed(2)}×</span>
                        {item.persistence_months > 0 && <span>· {item.persistence_months}m</span>}
                      </div>
                      {item.authorities[0] && (
                        <p className="mt-1 truncate text-[11px] text-ink-mute">
                          {item.authorities.slice(0, 2).map((a) => a.code).join(' · ')}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
