import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmtInt, fmtMonth, monthName, useT, type Key } from '@/app/i18n';
import { useCalendar } from '@/app/loaders';
import { SectionHeading, Spinner } from '@/components/ui';
import { api } from '@/lib/api';
import { fireColor, HOTSPOT_COLOR, SENSOR_COLOR } from '@/lib/colors';
import { fmtPercent, fmtRatio, fmtSigma, fmtTempC, localeFor } from '@/lib/format';
import { bboxId } from '@/lib/geo';
import type { AlertAssessment, BBox, EnsoPhase } from '@/lib/types';
import { useAoiName, useStore } from '@/store';
import { ensoDotClass, isEnsoRelevantAoi, severityStyle } from './alertMeta';
import { EnsoPanel } from './EnsoPanel';
import { NewsletterCard } from './NewsletterCard';
import { WarningGuideCard } from './WarningGuideCard';

const HOT = HOTSPOT_COLOR;
const COOL = SENSOR_COLOR.viirs;

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
    if (tz === 'Asia/Tokyo') return 'country:japan';
    const lang = (navigator.language || '').toUpperCase();
    if (lang.endsWith('-BR')) return 'country:brazil';
    if (lang.endsWith('-AR')) return 'ar';
    if (lang.endsWith('-CL')) return 'country:chile';
    if (lang.endsWith('-PE')) return 'country:peru';
    if (lang.endsWith('-MX')) return 'country:mexico';
    if (lang.endsWith('-US')) return 'country:united-states';
    if (lang.endsWith('-ES')) return 'country:spain';
    if (lang.endsWith('-PT')) return 'pt';
    if (lang.endsWith('-JP')) return 'country:japan';
  } catch {
    /* fallback below */
  }
  return 'co';
}

/** Select an alert territory in the store so the globe, calendar, charts, and transparency update together. */
async function focusAlertTerritory(item: AlertAssessment): Promise<void> {
  if (item.bbox && item.bbox.length === 4) {
    useStore.getState().setAoi({ id: item.aoi_id, name: item.region_name, bbox: item.bbox }, true);
    return;
  }
  const current = useStore.getState().aoi;
  useStore.getState().setAoi({ id: item.aoi_id, name: item.region_name, bbox: current.bbox }, false);
  const q = (item.department ?? item.country ?? item.region_name).replace(/,\s*Colombia$/i, '');
  try {
    const hits = await api.searchAoi(q);
    const match = hits.find((h) => h.id === item.aoi_id) ?? hits[0];
    if (match) {
      useStore.getState().setAoi(match, true);
    }
  } catch {
    /* keep fallback selection gracefully if search fails */
  }
}

export function Anomalies() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const aoiName = useAoiName();
  const visitorAoiId = useMemo(detectVisitorAoiId, []);
  const [sortKey, setSortKey] = useState<SortKey>('level');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filterText, setFilterText] = useState('');
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

  const countriesList = useMemo(() => overviewQ.data?.countries ?? [], [overviewQ.data]);

  // Unified global active alerts list (countries + sub-regions), deduped by AOI id and filtered strictly by search text.
  const activeAlerts = useMemo(() => {
    const merged = new Map<string, AlertAssessment>();
    for (const item of [...(overviewQ.data?.countries ?? []), ...(overviewQ.data?.colombia ?? [])]) {
      if (item.severity === 'NORMAL') continue;
      if (!merged.has(item.aoi_id)) merged.set(item.aoi_id, item);
    }
    return Array.from(merged.values());
  }, [overviewQ.data]);

  const directoryItems = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    const filtered = activeAlerts.filter((item) => {
      if (!needle) return true;
      return (
        item.region_name.toLowerCase().includes(needle) ||
        (item.country ?? '').toLowerCase().includes(needle) ||
        (item.department ?? '').toLowerCase().includes(needle) ||
        item.aoi_id.toLowerCase().includes(needle)
      );
    });
    const loc = localeFor(lang);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'territory') return dir * a.region_name.localeCompare(b.region_name, loc);
      if (sortKey === 'level') {
        if (a.severity_rank !== b.severity_rank) return dir * (a.severity_rank - b.severity_rank);
        return dir * (a.z_score - b.z_score);
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
  }, [activeAlerts, filterText, sortKey, sortDir, lang]);

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
    let a = peak,
      b = peak;
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
  const showEnso = isEnsoRelevantAoi(aoi, alert, ensoQ.data);
  const ensoCur = ensoQ.data?.current;
  const stripPhase: EnsoPhase | null = showEnso ? (ensoCur?.phase ?? alert?.enso_phase ?? null) : null;
  const stripOni = showEnso ? (ensoCur?.oni ?? alert?.oni_value ?? null) : null;
  const stripPhaseLabel =
    showEnso && stripPhase
      ? ensoCur
        ? (ensoCur.phase === 'EL_NINO' || ensoCur.phase === 'LA_NINA') && ensoCur.strength
          ? t(`enso.phase_${ensoCur.phase}_${ensoCur.strength}` as Key)
          : t(`enso.phase_${ensoCur.phase}` as Key)
        : t(`enso.phase_${stripPhase}` as Key)
      : null;

  const sortMark = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  // Visual gauge geometry + plain-language percentage summary for the active Early Warning block
  const alertBar = useMemo(() => {
    if (!alert) return null;
    const obs = Math.max(0, alert.latest_harmonized);
    const med = Math.max(0, alert.climatology_median);
    const p90 = Math.max(0, alert.climatology_p90);
    const scaleMax = Math.max(obs, p90, med * 1.4, 1);
    const pctDelta = Math.round((alert.anomaly_ratio - 1) * 100);
    const deltaLabel =
      Math.abs(pctDelta) < 8
        ? t('anom.alert_pct_normal')
        : pctDelta > 0
          ? t('anom.alert_pct_above', { pct: fmtInt(pctDelta, lang) })
          : t('anom.alert_pct_below', { pct: fmtInt(Math.abs(pctDelta), lang) });
    return {
      obsPct: Math.min(100, (obs / scaleMax) * 100),
      medPct: Math.min(100, (med / scaleMax) * 100),
      p90Pct: Math.min(100, (p90 / scaleMax) * 100),
      deltaLabel,
      pctDelta,
    };
  }, [alert, lang, t]);

  const zPlainLabel = (z: number) => {
    if (z >= 2) return t('cal.z_far_above');
    if (z >= 0.8) return t('cal.z_above');
    if (z <= -2) return t('cal.z_far_below');
    if (z <= -0.8) return t('cal.z_below');
    return t('cal.z_normal');
  };

  return (
    <section id="anomalies" ref={sectionRef} className="section" aria-labelledby="anomalies-title">
      <SectionHeading id="anomalies-title" eyebrow={t('anom.eyebrow')} title={t('anom.title')} lead={t('anom.lead')} />

      {/* 1. Global Early-Warning Monitor at the top: title + search input + clickable alert rows */}
      <article className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h3 className="card-title text-lg sm:text-xl">{t('anom.dir_title')}</h3>
            <p className="mt-1 text-sm text-ink-dim">{t('anom.dir_lead')}</p>
          </div>
          <label className="w-full sm:w-80">
            <span className="sr-only">{t('anom.filter_ph')}</span>
            <input
              type="search"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder={t('anom.filter_ph')}
              className="input text-sm"
            />
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
            {/* Mobile sort selector */}
            <label className="mt-4 flex items-center gap-2 text-xs text-ink-dim sm:hidden">
              <span>{t('anom.sort_by')}</span>
              <select
                value={sortKey}
                onChange={(e) => {
                  const next = e.target.value as SortKey;
                  setSortKey(next);
                  setSortDir(next === 'territory' || next === 'authority' ? 'asc' : 'desc');
                }}
                className="input min-h-8 w-auto py-1 text-xs"
              >
                <option value="level">{t('anom.col_level')}</option>
                <option value="z">{t('anom.col_sigma')}</option>
                <option value="ratio">{t('anom.col_ratio')}</option>
                <option value="nrt">{t('anom.col_nrt')}</option>
                <option value="territory">{t('anom.col_territory')}</option>
              </select>
            </label>

            {/* Mobile clickable rows */}
            <ul className="mt-4 max-h-96 divide-y divide-line/60 overflow-y-auto border-t border-line sm:hidden">
              {directoryItems.map((item) => {
                const st = severityStyle(item.severity);
                const auth = item.authorities[0];
                const label = lang === 'es' ? item.severity_label_es : item.severity_label_en;
                return (
                  <li
                    key={item.aoi_id}
                    tabIndex={0}
                    role="button"
                    aria-label={`${item.region_name} — ${label}`}
                    onClick={() => void focusAlertTerritory(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        void focusAlertTerritory(item);
                      }
                    }}
                    className={`cursor-pointer px-2 py-3 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cream ${
                      item.aoi_id === aoi.id ? 'bg-accent/15' : 'hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-ink">{item.region_name}</span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-ink">
                        <i aria-hidden className={`h-2 w-2 rounded-full ${st.dot}`} />
                        <span aria-hidden>{st.symbol}</span>
                        {label}
                      </span>
                    </div>
                    <div className="data mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-dim">
                      <span>{fmtRatio(item.anomaly_ratio, lang, 2)}</span>
                      <span>· {fmtSigma(item.z_score, lang, 2)}</span>
                      {item.nrt_detections != null && item.nrt_percent_of_normal != null && (
                        <span>
                          · {fmtInt(item.nrt_detections, lang)} {t('anom.det_abbr')} (
                          {fmtPercent(item.nrt_percent_of_normal, lang, 0)})
                        </span>
                      )}
                      {auth?.portal && (
                        <a
                          href={auth.portal}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="font-sans font-medium text-ink underline underline-offset-2"
                        >
                          {auth.code} ↗
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Desktop table: clicking anywhere on the row focuses that territory across the page */}
            <div className="mt-4 hidden max-h-[26rem] overflow-auto border-t border-line sm:block">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-line bg-graphite-800 text-xs text-ink-mute">
                  <tr>
                    {(
                      [
                        { key: 'territory', label: t('anom.col_territory'), align: 'left' },
                        { key: 'level', label: t('anom.col_level'), align: 'left' },
                        { key: 'ratio', label: t('anom.col_ratio'), align: 'right' },
                        { key: 'z', label: t('anom.col_sigma'), align: 'right' },
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
                          <span aria-hidden>{sortMark(col.key)}</span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {directoryItems.map((item) => {
                    const st = severityStyle(item.severity);
                    const auth = item.authorities[0];
                    const label = lang === 'es' ? item.severity_label_es : item.severity_label_en;
                    return (
                      <tr
                        key={item.aoi_id}
                        tabIndex={0}
                        role="button"
                        aria-label={`${item.region_name} — ${label}`}
                        onClick={() => void focusAlertTerritory(item)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void focusAlertTerritory(item);
                          }
                        }}
                        className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cream ${
                          item.aoi_id === aoi.id ? 'bg-accent/15' : 'hover:bg-white/[0.05]'
                        }`}
                      >
                        <td className="py-3 pl-2 pr-3 font-semibold text-ink">{item.region_name}</td>
                        <td className="whitespace-nowrap py-3 pr-3 text-ink">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <i aria-hidden className={`h-2 w-2 rounded-full ${st.dot}`} />
                            <span aria-hidden className="text-xs leading-none">
                              {st.symbol}
                            </span>
                            {label}
                          </span>
                        </td>
                        <td className="data whitespace-nowrap py-3 pr-3 text-right text-ink">
                          {fmtRatio(item.anomaly_ratio, lang, 2)}
                        </td>
                        <td className="data whitespace-nowrap py-3 pr-3 text-right text-ink-dim">
                          {fmtSigma(item.z_score, lang, 2)}
                        </td>
                        <td
                          className={`data whitespace-nowrap py-3 pr-3 text-right ${
                            (item.nrt_percent_of_normal ?? 0) >= 200
                              ? 'font-semibold text-sev-warning'
                              : 'text-ink-dim'
                          }`}
                        >
                          {item.nrt_detections != null && item.nrt_percent_of_normal != null
                            ? `${fmtInt(item.nrt_detections, lang)} ${t('anom.det_abbr')} · ${fmtPercent(item.nrt_percent_of_normal, lang, 0)}`
                            : '—'}
                        </td>
                        <td className="py-3 pr-2 text-xs">
                          {auth ? (
                            auth.portal ? (
                              <a
                                href={auth.portal}
                                target="_blank"
                                rel="noreferrer"
                                title={auth.name}
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 font-medium text-ink underline-offset-2 hover:text-accent hover:underline"
                              >
                                <span>{auth.code}</span>
                                <span aria-hidden>↗</span>
                              </a>
                            ) : (
                              <span title={auth.name} className="text-ink-dim">
                                {auth.code}
                              </span>
                            )
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </article>

      {/* 2. Borderless guide explaining warning levels & statistical indicators */}
      <WarningGuideCard />

      {/* 3. Active Territory Summary Strip */}
      <div className="mt-12 border-t border-line pt-10 text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h3 className="font-display text-2xl text-ink sm:text-3xl">{aoiName}</h3>
          {alert && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border bg-cream-deep/60 px-3 py-1 text-xs font-medium text-ink ${severityStyle(alert.severity).border}`}
            >
              <i aria-hidden className={`h-2.5 w-2.5 rounded-full ring-1 ring-ink/15 ${severityStyle(alert.severity).dot}`} />
              <span aria-hidden className="text-xs leading-none">
                {severityStyle(alert.severity).symbol}
              </span>
              <span>{lang === 'es' ? alert.severity_label_es : alert.severity_label_en}</span>
            </span>
          )}
          {showEnso && stripPhase && stripPhaseLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-cream-deep/60 px-3 py-1 text-xs font-medium text-ink">
              <i aria-hidden className={`h-2.5 w-2.5 rounded-full ${ensoDotClass(stripPhase)}`} />
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
        ) : alert && alertBar ? (
          <p className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm text-ink-dim">
            <span className="font-medium text-ink">{alertBar.deltaLabel}</span>
            <span aria-hidden>·</span>
            <span className="data">
              {t('anom.card_counts', {
                latest: fmtInt(Math.round(alert.latest_harmonized), lang),
                normal: fmtInt(Math.round(alert.climatology_median), lang),
              })}
            </span>
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

      {/* 4. Typical critical season + Most unusual periods chart panel */}
      <article className="panel mt-6 p-5 sm:p-6">
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
                  const ensoPhase = showEnso ? phaseForMonth(a.start) : null;
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

      {/* 5. El Niño / La Niña teleconnection chart — strictly hidden outside Pacific ENSO-affected territories */}
      {showEnso && (
        <EnsoPanel aoiName={aoiName} lang={lang} data={ensoQ.data} isPending={ensoQ.isPending} isError={ensoQ.isError} />
      )}

      {/* 6. Plain-Language Early-Warning Detail integrated directly on cream */}
      <div className="mt-12 border-t border-line pt-10" aria-labelledby="early-warning-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="eyebrow">{t('anom.alert_eyebrow')}</p>
              {alert && (
                <span className="text-xs font-medium text-ink-mute">
                  · {alert.protocol === 'CAP-1.2-deterministic' ? t('anom.protocol_cap') : alert.protocol}
                </span>
              )}
            </div>
            <h3 id="early-warning-title" className="mt-1.5 font-display text-2xl text-ink sm:text-3xl">
              {t('anom.alert_title', { region: alert?.region_name ?? aoiName })}
            </h3>
          </div>
          {alertQ.isError ? (
            <span className="text-sm text-ink-dim">{t('common.error')}</span>
          ) : alertQ.isLoading ? (
            <Spinner label={t('common.loading')} />
          ) : alert ? (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border bg-cream-deep/60 px-3 py-1 text-xs font-semibold text-ink ${severityStyle(alert.severity).border}`}
            >
              <i aria-hidden className={`h-2.5 w-2.5 rounded-full ring-1 ring-ink/15 ${severityStyle(alert.severity).dot}`} />
              <span aria-hidden className="text-xs leading-none">
                {severityStyle(alert.severity).symbol}
              </span>
              <span>{lang === 'es' ? alert.severity_label_es : alert.severity_label_en}</span>
            </span>
          ) : null}
        </div>

        {alert && alertBar && (
          <div className="mt-6 space-y-8">
            <div>
              <p className="text-base font-medium text-ink">{t(`anom.alert_sev_desc_${alert.severity}`)}</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-dim">
                {lang === 'es' ? alert.headline_es : alert.headline_en}
              </p>

              {/* Visual comparison bar against 26-year historical normal & p90 */}
              <div className="mt-5 max-w-3xl">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-dim">
                  <span>{t('anom.alert_bar_label')}</span>
                  <span className="font-semibold text-ink">{alertBar.deltaLabel}</span>
                </div>
                <div className="relative mt-2 h-3 w-full overflow-hidden rounded-full bg-cream-deep">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${severityStyle(alert.severity).dot}`}
                    style={{ width: `${Math.max(alertBar.obsPct, 3)}%` }}
                  />
                  {alert.climatology_median > 0 && (
                    <span
                      title={t('anom.alert_bar_typical')}
                      className="absolute inset-y-0 w-0.5 bg-ink"
                      style={{ left: `${alertBar.medPct}%` }}
                    />
                  )}
                  {alert.climatology_p90 > 0 && (
                    <span
                      title={t('anom.alert_bar_extreme')}
                      className="absolute inset-y-0 w-0.5 bg-sev-critical"
                      style={{ left: `${alertBar.p90Pct}%` }}
                    />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-dim">
                  <span>
                    <strong className="text-ink">{t('anom.alert_bar_observed')}:</strong>{' '}
                    <span className="data">{fmtInt(Math.round(alert.latest_harmonized), lang)}</span>
                  </span>
                  <span>
                    <strong className="text-ink">{t('anom.alert_bar_typical')}:</strong>{' '}
                    <span className="data">{fmtInt(Math.round(alert.climatology_median), lang)}</span>
                  </span>
                  <span>
                    <strong className="text-ink">{t('anom.alert_bar_extreme')}:</strong>{' '}
                    <span className="data">{fmtInt(Math.round(alert.climatology_p90), lang)}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Clean borderless key indicators on cream */}
            <dl
              className={`grid gap-6 border-y border-line/60 py-5 sm:grid-cols-2 ${
                showEnso ? 'lg:grid-cols-5' : 'lg:grid-cols-4'
              }`}
            >
              <div className="border-l-2 border-line pl-3.5">
                <dt className="text-xs text-ink-mute">{t('anom.alert_ratio')}</dt>
                <dd className="data mt-1 text-lg font-semibold text-ink">{fmtRatio(alert.anomaly_ratio, lang, 2)}</dd>
                <dd className="mt-0.5 text-xs text-ink-dim">{alertBar.deltaLabel}</dd>
              </div>

              <div className="border-l-2 border-line pl-3.5">
                <dt className="text-xs text-ink-mute">{t('anom.alert_trend')}</dt>
                <dd className="mt-1 text-lg font-semibold text-ink">{t(`anom.alert_trend_${alert.trend_direction}`)}</dd>
                <dd className="data mt-0.5 text-xs text-ink-dim">
                  {alert.persistence_months === 1
                    ? t('anom.alert_month_1')
                    : t('anom.alert_months_n', { n: fmtInt(alert.persistence_months, lang) })}
                  {alert.unseasonal ? ` · ${t('anom.alert_unseasonal')}` : ''}
                </dd>
              </div>

              <div className="border-l-2 border-line pl-3.5">
                <dt className="text-xs text-ink-mute">{t('anom.col_sigma')}</dt>
                <dd className="data mt-1 text-lg font-semibold text-ink">{fmtSigma(alert.z_score, lang, 2)}</dd>
                <dd className="mt-0.5 text-xs text-ink-dim capitalize">{zPlainLabel(alert.z_score)}</dd>
              </div>

              <div className="border-l-2 border-line pl-3.5">
                <dt className="text-xs text-ink-mute">{t('anom.alert_nrt')}</dt>
                <dd
                  className={`data mt-1 text-lg font-semibold ${
                    (alert.nrt_percent_of_normal ?? 0) >= 200 ? 'text-sev-warning' : 'text-ink'
                  }`}
                >
                  {alert.nrt_detections != null ? `${fmtInt(alert.nrt_detections, lang)} ${t('anom.det_abbr')}` : '—'}
                </dd>
                <dd className="data mt-0.5 text-xs text-ink-dim">
                  {alert.nrt_percent_of_normal != null
                    ? `${fmtPercent(alert.nrt_percent_of_normal, lang, 0)} ${t('anom.alert_ratio').toLowerCase()}`
                    : '—'}
                </dd>
              </div>

              {showEnso && (
                <div className="border-l-2 border-line pl-3.5">
                  <dt className="text-xs text-ink-mute">{t('anom.alert_enso')}</dt>
                  <dd className="mt-1 text-lg font-semibold text-ink">{t(`enso.phase_${alert.enso_phase}` as Key)}</dd>
                  <dd className="data mt-0.5 text-xs text-ink-dim">
                    {alert.oni_value != null ? `ONI ${fmtTempC(alert.oni_value, lang, 2)}` : 'NOAA CPC'}
                  </dd>
                </div>
              )}
            </dl>

            {/* Two-column editorial details matching Methodology layout: Actions + Scientific Breakdown | Authorities + Visitor Location */}
            <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
              <div className="space-y-6">
                <div>
                  <p className="eyebrow">{t('anom.alert_actions')}</p>
                  <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-dim">
                    {(lang === 'es' ? alert.recommended_actions_es : alert.recommended_actions_en).map((step, idx) => (
                      <li key={idx} className="flex gap-2.5">
                        <span className="data text-ink-mute">{idx + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <details className="group border-t border-line/60 pt-4">
                  <summary className="cursor-pointer select-none list-none text-xs font-semibold text-ink hover:opacity-80">
                    <span className="mr-1.5 inline-block transition-transform duration-200 group-open:rotate-90">▸</span>
                    {t('anom.alert_tech_toggle')}
                  </summary>
                  <p className="mt-3 border-l-2 border-line pl-3.5 text-sm leading-relaxed text-ink-dim">
                    {lang === 'es' ? alert.technical_summary_es : alert.technical_summary_en}
                  </p>
                </details>
              </div>

              <div className="space-y-6">
                <div>
                  <p className="eyebrow">{t('anom.alert_authorities')}</p>
                  <ul className="mt-3 divide-y divide-line/60 border-t border-line/60">
                    {alert.authorities.map((auth) => (
                      <li key={auth.code} className="py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-ink">
                            {auth.code} — {auth.name}
                          </span>
                          {auth.portal && (
                            <a
                              href={auth.portal}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-8 items-center rounded-md border border-line px-3 py-1 text-xs font-semibold text-ink transition-colors hover:border-ink hover:bg-cream-deep/60"
                            >
                              {t('anom.alert_portal')} ↗
                            </a>
                          )}
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-ink-dim">
                          {lang === 'es' ? auth.role_es : auth.role_en}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Compact visitor location & GPS inspection bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/60 pt-4">
                  <div className="space-y-0.5">
                    <p className="eyebrow">{t('anom.loc_detected')}</p>
                    {visitorQ.isLoading ? (
                      <Spinner label={t('common.loading')} />
                    ) : visitorQ.data ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <strong className="font-semibold text-ink">{visitorQ.data.region_name}</strong>
                        <span className="text-ink-dim">
                          ({lang === 'es' ? visitorQ.data.severity_label_es : visitorQ.data.severity_label_en} ·{' '}
                          <span className="data">{fmtSigma(visitorQ.data.z_score, lang, 2)}</span>)
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {visitorQ.data && visitorQ.data.aoi_id !== aoi.id && (
                      <button
                        type="button"
                        onClick={() => void focusAlertTerritory(visitorQ.data)}
                        className="inline-flex min-h-8 items-center rounded-md border border-line px-3 py-1 text-xs font-semibold text-ink transition-colors hover:border-ink hover:bg-cream-deep/60"
                      >
                        {t('anom.loc_fly')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={requestGpsLocation}
                      disabled={gpsStatus === 'loading'}
                      className="inline-flex min-h-8 items-center rounded-md border border-line px-3 py-1 text-xs font-semibold text-ink transition-colors hover:border-ink hover:bg-cream-deep/60"
                    >
                      {gpsStatus === 'loading' ? t('common.loading') : t('anom.loc_gps')}
                    </button>
                    {gpsStatus === 'denied' && <span className="text-xs text-ink-dim">{t('anom.loc_gps_denied')}</span>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 7. Borderless SMTP email newsletter subscription integrated on cream */}
      <NewsletterCard
        currentAoiId={aoi.id}
        currentAoiName={aoiName}
        countries={countriesList}
        alerts={activeAlerts}
        lang={lang}
      />
    </section>
  );
}
