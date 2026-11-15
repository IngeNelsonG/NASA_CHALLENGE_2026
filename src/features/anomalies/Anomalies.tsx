import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtInt, fmtMonth, monthName, useT, type Key } from '@/app/i18n';
import { useCalendar } from '@/app/loaders';
import { SectionHeading, Segmented, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { fireColor, HOTSPOT_COLOR, SENSOR_COLOR } from '@/lib/colors';
import { fmtPercent, fmtRatio, fmtSigma, fmtTempC, localeFor } from '@/lib/format';
import { bboxId } from '@/lib/geo';
import type { AlertAssessment, BBox, EnsoPhase } from '@/lib/types';
import { useStore } from '@/store';
import { EnsoPanel } from './EnsoPanel';

const HOT = HOTSPOT_COLOR;
const COOL = SENSOR_COLOR.viirs;

type AlertTab = 'summary' | 'authorities' | 'location';
type SortKey = 'territory' | 'level' | 'z' | 'ratio' | 'nrt' | 'authority';
type SortDir = 'asc' | 'desc';

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

function severityDotClass(sev: AlertAssessment['severity']): string {
  if (sev === 'CRITICAL') return 'bg-sev-critical';
  if (sev === 'WARNING') return 'bg-sev-warning';
  if (sev === 'WATCH') return 'bg-sev-watch';
  return 'bg-sev-normal';
}

function ensoDotClass(phase: EnsoPhase): string {
  if (phase === 'EL_NINO') return 'bg-accent';
  if (phase === 'LA_NINA') return 'bg-viirs';
  return 'bg-ink-mute';
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
  const [alertTab, setAlertTab] = useState<AlertTab>('summary');
  const [sortKey, setSortKey] = useState<SortKey>('level');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterText, setFilterText] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'denied'>('idle');
  const sectionRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          io.disconnect();
        }
      },
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const q = useQuery({ queryKey: ['anomalies', aoi.id], queryFn: ({ signal }) => api.anomalies(aoi.id, signal) });
  const alertQ = useQuery({ queryKey: ['alerts', aoi.id], queryFn: ({ signal }) => api.alerts(aoi.id, signal) });
  const visitorQ = useQuery({
    queryKey: ['alerts', visitorAoiId],
    queryFn: ({ signal }) => api.alerts(visitorAoiId, signal),
    enabled: nearViewport,
  });
  const overviewQ = useQuery({
    queryKey: ['alerts-overview'],
    queryFn: ({ signal }) => api.alertsOverview(signal),
    staleTime: 5 * 60_000,
    enabled: nearViewport,
  });
  const ensoQ = useQuery({
    queryKey: ['enso', aoi.id],
    queryFn: ({ signal }) => api.enso(aoi.id, signal),
    enabled: nearViewport,
  });
  const monthly = useCalendar('month');

  const oniByMonth = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const pt of ensoQ.data?.series ?? []) map.set(pt.month.slice(0, 7), pt.oni);
    return map;
  }, [ensoQ.data]);

  const phaseForMonth = (iso: string): EnsoPhase | null => {
    const oni = oniByMonth.get(iso.slice(0, 7));
    if (oni == null) return null;
    if (oni >= 0.5) return 'EL_NINO';
    if (oni <= -0.5) return 'LA_NINA';
    return 'NEUTRAL';
  };

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
    const filtered = raw.filter((item) => {
      if (activeOnly && item.severity === 'NORMAL') return false;
      if (!needle) return true;
      return item.region_name.toLowerCase().includes(needle) || item.aoi_id.toLowerCase().includes(needle);
    });
    const loc = localeFor(lang);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'territory') return dir * a.region_name.localeCompare(b.region_name, loc);
      if (sortKey === 'level') {
        const diff = a.severity_rank - b.severity_rank;
        return dir * (diff !== 0 ? diff : a.z_score - b.z_score);
      }
      if (sortKey === 'z') return dir * (a.z_score - b.z_score);
      if (sortKey === 'ratio') return dir * (a.anomaly_ratio - b.anomaly_ratio);
      if (sortKey === 'nrt') {
        const av = a.nrt_percent_of_normal;
        const bv = b.nrt_percent_of_normal;
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return dir * (av - bv);
      }
      const aa = a.authorities[0]?.code ?? '';
      const ba = b.authorities[0]?.code ?? '';
      return dir * aa.localeCompare(ba, loc);
    });
  }, [overviewQ.data, tab, filterText, activeOnly, sortKey, sortDir, lang]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'territory' || key === 'authority' ? 'asc' : 'desc');
    }
  };

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

  const alert = alertQ.data;
  const ensoCur = ensoQ.data?.current;
  const stripPhase: EnsoPhase | null = ensoCur?.phase ?? alert?.enso_phase ?? null;
  const stripOni = ensoCur?.oni ?? alert?.oni_value ?? null;
  const stripPhaseLabel = ensoCur
    ? (ensoCur.phase === 'EL_NINO' || ensoCur.phase === 'LA_NINA') && ensoCur.strength
      ? t(`enso.phase_${ensoCur.phase}_${ensoCur.strength}` as Key)
      : t(`enso.phase_${ensoCur.phase}` as Key)
    : stripPhase
      ? t(`enso.phase_${stripPhase}` as Key)
      : null;

  const sortMark = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <section id="anomalies" ref={sectionRef} className="section" aria-labelledby="anomalies-title">
      <SectionHeading id="anomalies-title" eyebrow={t('anom.eyebrow')} title={t('anom.title')} lead={t('anom.lead')} />

      {/* Top summary strip (borderless on cream, calm, left-aligned) */}
      <div className="mb-8 border-b border-line pb-6 text-left">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <h3 className="font-display text-2xl text-ink sm:text-3xl">{aoi.name}</h3>
          {alert && (
            <span className="chip text-ink">
              <i aria-hidden className={`h-2 w-2 rounded-full ${severityDotClass(alert.severity)}`} />
              <span>{lang === 'es' ? alert.severity_label_es : alert.severity_label_en}</span>
            </span>
          )}
          {stripPhase && stripPhaseLabel && (
            <span className="chip text-ink">
              <i aria-hidden className={`h-2 w-2 rounded-full ${ensoDotClass(stripPhase)}`} />
              <span>
                {stripPhaseLabel}
                {stripOni != null && (
                  <>
                    {' '}
                    · <span className="data">ONI {fmtTempC(stripOni, lang, 2)}</span>
                  </>
                )}
              </span>
            </span>
          )}
        </div>
        {alertQ.isLoading ? (
          <div className="mt-2.5">
            <Spinner label={t('common.loading')} />
          </div>
        ) : alert ? (
          <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm text-ink-dim">
            <span className="data text-ink">
              {t('anom.card_counts', {
                latest: fmtInt(Math.round(alert.latest_harmonized), lang),
                normal: fmtInt(Math.round(alert.climatology_median), lang),
              })}
            </span>
            <span aria-hidden>·</span>
            <span className="data">{fmtSigma(alert.z_score, lang, 2)}</span>
            <span aria-hidden>·</span>
            <span className="data">{fmtRatio(alert.anomaly_ratio, lang, 2)}</span>
            {alert.nrt_detections != null && alert.nrt_percent_of_normal != null && (
              <>
                <span aria-hidden>·</span>
                <span
                  className={`data ${
                    alert.nrt_percent_of_normal >= 200
                      ? 'font-semibold text-ink underline decoration-sev-warning decoration-2 underline-offset-4'
                      : ''
                  }`}
                >
                  {t('anom.card_nrt', {
                    det: fmtInt(alert.nrt_detections, lang),
                    pct: fmtPercent(alert.nrt_percent_of_normal, lang, 0),
                  })}
                </span>
              </>
            )}
          </p>
        ) : null}
      </div>

      {/* Typical critical season + Most unusual periods in one calm two-column panel */}
      <article className="panel p-5 sm:p-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr] lg:gap-10">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-ink">{t('anom.season_title')}</h3>
            {season ? (
              <>
                <p className="data mt-3 text-2xl text-ink sm:text-3xl">
                  {monthName(season.a, lang, 'long')} – {monthName(season.b, lang, 'long')}
                </p>
                <p className="mt-1.5 text-sm text-ink-dim">
                  {t('anom.season_share', { pct: Math.round(season.share * 100), peak: monthName(season.peak, lang, 'long') })}
                </p>
                <ol className="mt-5 grid grid-cols-12 gap-1" aria-label={t('anom.season_aria')}>
                  {season.means.map((v, m) => (
                    <li key={m} className="text-center" title={`${monthName(m, lang, 'long')}: ${fmtInt(v, lang)}`}>
                      <div
                        className={`h-11 rounded-sm ${season.inSeason(m) ? 'outline outline-2 outline-offset-1 outline-white' : ''}`}
                        style={{ background: fireColor(v, season.max) }}
                      />
                      <span className={`mt-1.5 block text-xs ${season.inSeason(m) ? 'font-semibold text-ink' : 'text-ink-dim'}`}>
                        {monthName(m, lang, 'narrow')}
                      </span>
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
          </div>

          <div className="min-w-0 border-t border-line pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-ink">{t('anom.list_title')}</h3>
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
              <ul className="mt-3 divide-y divide-line/60">
                {list.map((a) => {
                  const pos = a.zScore > 0;
                  const w = (Math.abs(a.zScore) / zMax) * 50;
                  const same = a.start.slice(0, 7) === a.end.slice(0, 7);
                  const ensoPhase = phaseForMonth(a.start);
                  return (
                    <li key={a.start + a.end}>
                      <button
                        type="button"
                        onClick={() => open(a.start)}
                        title={a.label}
                        className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-1 py-2.5 text-left transition-colors hover:bg-white/[0.04] sm:grid-cols-[minmax(10.5rem,1.25fr)_1fr_auto]"
                      >
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="data text-sm text-ink">
                            {fmtMonth(a.start, lang)}
                            {!same && <> – {fmtMonth(a.end, lang)}</>}
                          </span>
                          {ensoPhase && (
                            <span className="chip !px-2 !py-0.5 text-xs">{t(`enso.phase_${ensoPhase}` as Key)}</span>
                          )}
                        </span>
                        <span className="data text-right text-sm text-ink sm:order-3 sm:w-20">
                          {fmtSigma(a.zScore, lang, 1)}
                        </span>
                        <span aria-hidden className="relative col-span-2 h-1.5 sm:order-2 sm:col-span-1">
                          <span className="absolute -top-1 bottom-0 left-1/2 h-3.5 w-px bg-ink-mute/70" />
                          <span
                            className="absolute inset-y-0 rounded-full"
                            style={
                              pos
                                ? { left: 'calc(50% + 1px)', width: `${w}%`, background: HOT }
                                : { right: 'calc(50% + 1px)', width: `${w}%`, background: COOL }
                            }
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-xs leading-relaxed text-ink-mute">{t('anom.list_note')}</p>
          </div>
        </div>
      </article>

      <EnsoPanel aoiName={aoi.name} lang={lang} data={ensoQ.data} isPending={ensoQ.isPending} isError={ensoQ.isError} />

      {/* Deterministic Early-Warning Alert Panel with header + progressive tabs */}
      <article className="panel mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow">{t('anom.alert_eyebrow')}</p>
              {alert && (
                <span className="chip">
                  {alert.protocol === 'CAP-1.2-deterministic' ? t('anom.protocol_cap') : alert.protocol}
                </span>
              )}
            </div>
            <h3 className="card-title mt-1.5 text-lg">
              {t('anom.alert_title')} — <span className="font-semibold text-ink">{aoi.name}</span>
            </h3>
          </div>
          {alertQ.isError ? (
            <span className="text-xs text-ink-dim">{t('common.error')}</span>
          ) : alertQ.isLoading ? (
            <Spinner label={t('common.loading')} />
          ) : alert ? (
            <span className="chip text-ink">
              <i aria-hidden className={`h-2 w-2 rounded-full ${severityDotClass(alert.severity)}`} />
              {lang === 'es' ? alert.severity_label_es : alert.severity_label_en}
            </span>
          ) : null}
        </div>

        {alert && (
          <div className="mt-5 space-y-6">
            <p className="text-sm font-medium text-ink">
              {lang === 'es' ? alert.headline_es : alert.headline_en}
            </p>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
              <div>
                <dt className="text-xs text-ink-mute">{t('cal.anomaly')}</dt>
                <dd className="data mt-0.5 text-sm text-ink">{fmtSigma(alert.z_score, lang, 2)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-mute">{t('anom.alert_ratio')}</dt>
                <dd className="data mt-0.5 text-sm text-ink">{fmtRatio(alert.anomaly_ratio, lang, 2)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-mute">{t('anom.alert_persist')}</dt>
                <dd className="data mt-0.5 text-sm text-ink">
                  {alert.persistence_months === 1
                    ? t('anom.alert_month_1')
                    : t('anom.alert_months_n', { n: fmtInt(alert.persistence_months, lang) })}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-mute">{t('anom.alert_trend')}</dt>
                <dd className="mt-0.5 text-sm text-ink">{t(`anom.alert_trend_${alert.trend_direction}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-mute">{t('anom.alert_enso')}</dt>
                <dd className="data mt-0.5 text-sm text-ink">
                  {t(`enso.phase_${alert.enso_phase}` as Key)}
                  {alert.oni_value != null ? ` (${fmtTempC(alert.oni_value, lang, 2)})` : ''}
                </dd>
              </div>
              {alert.unseasonal && (
                <div>
                  <dt className="text-xs text-ink-mute">{t('anom.season_title')}</dt>
                  <dd className="mt-0.5 text-sm text-ink">{t('anom.alert_unseasonal')}</dd>
                </div>
              )}
              {(alert.nrt_detections != null || alert.nrt_percent_of_normal != null) && (
                <div>
                  <dt className="text-xs text-ink-mute">{t('anom.alert_nrt')}</dt>
                  <dd
                    className={`data mt-0.5 text-sm ${
                      (alert.nrt_percent_of_normal ?? 0) >= 200 ? 'font-semibold text-sev-warning' : 'text-ink'
                    }`}
                  >
                    {alert.nrt_detections != null ? `${fmtInt(alert.nrt_detections, lang)} ${t('anom.det_abbr')}` : ''}
                    {alert.nrt_detections != null && alert.nrt_percent_of_normal != null ? ' · ' : ''}
                    {alert.nrt_percent_of_normal != null ? fmtPercent(alert.nrt_percent_of_normal, lang, 0) : ''}
                  </dd>
                </div>
              )}
            </dl>

            <div className="border-t border-line pt-5">
              <div
                role="tablist"
                aria-label={t('anom.alert_tabs_aria')}
                className="inline-flex flex-wrap rounded-lg border border-line bg-graphite-900/70 p-0.5"
              >
                {(
                  [
                    { id: 'summary', label: t('anom.tab_summary') },
                    { id: 'authorities', label: t('anom.tab_authorities') },
                    { id: 'location', label: t('anom.tab_location') },
                  ] as const
                ).map((item) => {
                  const active = alertTab === item.id;
                  return (
                    <button
                      key={item.id}
                      id={`alert-tab-${item.id}`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls={`alert-panel-${item.id}`}
                      onClick={() => setAlertTab(item.id)}
                      className={`min-h-[34px] rounded-md px-3 text-xs font-semibold transition-colors duration-200 ${
                        active ? 'bg-cream text-coal' : 'text-ink-dim hover:bg-graphite-700 hover:text-ink'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {alertTab === 'summary' && (
                <div
                  id="alert-panel-summary"
                  role="tabpanel"
                  aria-labelledby="alert-tab-summary"
                  className="mt-5 space-y-5"
                >
                  <p className="text-sm leading-relaxed text-ink-dim">
                    {lang === 'es' ? alert.technical_summary_es : alert.technical_summary_en}
                  </p>
                  <div className="border-t border-line/60 pt-4">
                    <p className="eyebrow">{t('anom.alert_actions')}</p>
                    <ul className="mt-2.5 space-y-2 text-sm leading-relaxed text-ink-dim">
                      {(lang === 'es' ? alert.recommended_actions_es : alert.recommended_actions_en).map((step, idx) => (
                        <li key={idx} className="flex gap-2.5">
                          <span className="data text-ink-mute">{idx + 1}.</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {alertTab === 'authorities' && (
                <div
                  id="alert-panel-authorities"
                  role="tabpanel"
                  aria-labelledby="alert-tab-authorities"
                  className="mt-5"
                >
                  <p className="eyebrow">{t('anom.alert_authorities')}</p>
                  <ul className="mt-3 divide-y divide-line/60">
                    {alert.authorities.map((auth) => (
                      <li key={auth.code} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-ink">{auth.code}</span>
                          {auth.portal && (
                            <a
                              href={auth.portal}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-ink-dim underline-offset-2 hover:text-ink hover:underline"
                            >
                              {t('anom.alert_portal')} ↗
                            </a>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs font-medium text-ink-dim">{auth.name}</p>
                        <p className="mt-1 text-xs leading-relaxed text-ink-mute">
                          {lang === 'es' ? auth.role_es : auth.role_en}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {alertTab === 'location' && (
                <div
                  id="alert-panel-location"
                  role="tabpanel"
                  aria-labelledby="alert-tab-location"
                  className="mt-5 flex flex-wrap items-center justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <p className="eyebrow">{t('anom.loc_detected')}</p>
                    {visitorQ.isLoading ? (
                      <Spinner label={t('common.loading')} />
                    ) : visitorQ.data ? (
                      <div className="flex flex-wrap items-center gap-2.5 text-sm">
                        <strong className="font-semibold text-ink">{visitorQ.data.region_name}</strong>
                        <span className="chip text-ink">
                          <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${severityDotClass(visitorQ.data.severity)}`} />
                          {lang === 'es' ? visitorQ.data.severity_label_es : visitorQ.data.severity_label_en}
                        </span>
                        <span className="data text-xs text-ink-dim">({fmtSigma(visitorQ.data.z_score, lang, 2)})</span>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-dim">{t('common.error')}</p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {visitorQ.data && visitorQ.data.aoi_id !== aoi.id && (
                      <button
                        type="button"
                        onClick={() => void focusAlertTerritory(visitorQ.data)}
                        className="btn btn-sm"
                      >
                        {t('anom.loc_fly')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={requestGpsLocation}
                      disabled={gpsStatus === 'loading'}
                      className="btn btn-sm"
                    >
                      {gpsStatus === 'loading' ? t('common.loading') : t('anom.loc_gps')}
                    </button>
                    {gpsStatus === 'denied' && <span className="text-xs text-ink-dim">{t('anom.loc_gps_denied')}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </article>

      {/* Interactive Country & Colombia Departments Alert Monitor (compact sortable table) */}
      <article className="panel mt-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h4 className="card-title text-lg">{t('anom.dir_title')}</h4>
            <p className="mt-0.5 text-xs text-ink-dim">{t('anom.dir_lead')}</p>
          </div>
          <Segmented<'countries' | 'colombia'>
            size="sm"
            label={t('anom.dir_title')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'countries', label: `${t('anom.tab_countries')} (${overviewQ.data?.countries.length ?? 0})` },
              { value: 'colombia', label: `${t('anom.tab_colombia')} (${overviewQ.data?.colombia.length ?? 0})` },
            ]}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
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
                className="accent-accent"
              />
              {t('anom.active_only')}
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink-dim sm:hidden">
            <span>{t('anom.sort_by')}</span>
            <select
              value={sortKey}
              onChange={(e) => {
                const next = e.target.value as SortKey;
                setSortKey(next);
                setSortDir(next === 'territory' || next === 'authority' ? 'asc' : 'desc');
              }}
              className="input !min-h-8 w-auto !py-1 text-xs"
            >
              <option value="level">{t('anom.col_level')}</option>
              <option value="z">{t('anom.col_sigma')}</option>
              <option value="ratio">{t('anom.col_ratio')}</option>
              <option value="nrt">{t('anom.col_nrt')}</option>
              <option value="territory">{t('anom.col_territory')}</option>
            </select>
          </label>
        </div>

        {overviewQ.isLoading ? (
          <div className="mt-6 flex justify-center py-8">
            <Spinner label={t('common.loading')} />
          </div>
        ) : directoryItems.length === 0 ? (
          <p className="mt-6 text-sm text-ink-dim">{t('anom.dir_empty')}</p>
        ) : (
          <>
            {/* Compact two-line rows on < 640px */}
            <ul className="mt-4 max-h-96 divide-y divide-line/60 overflow-y-auto border-t border-line sm:hidden">
              {directoryItems.map((item) => (
                <li key={item.aoi_id}>
                  <button
                    type="button"
                    onClick={() => void focusAlertTerritory(item)}
                    className={`w-full px-1 py-2.5 text-left transition-colors ${
                      item.aoi_id === aoi.id ? 'bg-accent/10' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{item.region_name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink">
                        <i aria-hidden className={`h-2 w-2 rounded-full ${severityDotClass(item.severity)}`} />
                        {lang === 'es' ? item.severity_label_es : item.severity_label_en}
                      </span>
                    </div>
                    <div className="data mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-ink-dim">
                      <span>{fmtSigma(item.z_score, lang, 2)}</span>
                      <span>· {fmtRatio(item.anomaly_ratio, lang, 2)}</span>
                      {item.nrt_detections != null && item.nrt_percent_of_normal != null && (
                        <span className={item.nrt_percent_of_normal >= 200 ? 'font-semibold text-sev-warning' : ''}>
                          · {fmtInt(item.nrt_detections, lang)} {t('anom.det_abbr')} (
                          {fmtPercent(item.nrt_percent_of_normal, lang, 0)})
                        </span>
                      )}
                      {item.authorities[0] && (
                        <span className="basis-full truncate font-sans text-ink-mute">{item.authorities[0].code}</span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            {/* Sortable table with sticky header on >= 640px */}
            <div className="mt-4 hidden max-h-96 overflow-auto border-t border-line sm:block">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-line bg-graphite-800 text-ink-mute">
                  <tr>
                    {(
                      [
                        { key: 'territory', label: t('anom.col_territory'), align: 'left' },
                        { key: 'level', label: t('anom.col_level'), align: 'left' },
                        { key: 'z', label: t('anom.col_sigma'), align: 'right' },
                        { key: 'ratio', label: t('anom.col_ratio'), align: 'right' },
                        { key: 'nrt', label: t('anom.col_nrt'), align: 'right' },
                        { key: 'authority', label: t('anom.col_authority'), align: 'left' },
                      ] as const
                    ).map((col) => (
                      <th
                        key={col.key}
                        aria-sort={ariaSort(col.key)}
                        className={`py-2.5 pr-3 font-medium uppercase tracking-wider ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className="inline-flex items-center gap-1 hover:text-ink"
                        >
                          <span>{col.label}</span>
                          <span aria-hidden className="text-xs">
                            {sortMark(col.key)}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {directoryItems.map((item) => (
                    <tr
                      key={item.aoi_id}
                      onClick={() => void focusAlertTerritory(item)}
                      className={`cursor-pointer transition-colors ${
                        item.aoi_id === aoi.id ? 'bg-accent/10' : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <td className="py-2.5 pr-3 font-semibold text-ink">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void focusAlertTerritory(item);
                          }}
                          className="text-left hover:underline"
                        >
                          {item.region_name}
                        </button>
                      </td>
                      <td className="whitespace-nowrap py-2.5 pr-3 text-ink">
                        <span className="inline-flex items-center gap-1.5">
                          <i aria-hidden className={`h-2 w-2 rounded-full ${severityDotClass(item.severity)}`} />
                          {lang === 'es' ? item.severity_label_es : item.severity_label_en}
                        </span>
                      </td>
                      <td className="data whitespace-nowrap py-2.5 pr-3 text-right text-ink">
                        {fmtSigma(item.z_score, lang, 2)}
                      </td>
                      <td className="data whitespace-nowrap py-2.5 pr-3 text-right text-ink-dim">
                        {fmtRatio(item.anomaly_ratio, lang, 2)}
                      </td>
                      <td
                        className={`data whitespace-nowrap py-2.5 pr-3 text-right ${
                          (item.nrt_percent_of_normal ?? 0) >= 200
                            ? 'font-semibold text-sev-warning'
                            : 'text-ink-dim'
                        }`}
                      >
                        {item.nrt_detections != null && item.nrt_percent_of_normal != null
                          ? `${fmtInt(item.nrt_detections, lang)} ${t('anom.det_abbr')} · ${fmtPercent(item.nrt_percent_of_normal, lang, 0)}`
                          : '—'}
                      </td>
                      <td className="max-w-[13rem] truncate py-2.5 text-ink-mute">
                        {item.authorities[0]?.code ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </article>
    </section>
  );
}
