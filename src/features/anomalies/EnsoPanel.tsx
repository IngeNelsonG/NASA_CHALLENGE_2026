import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtMonth, monthName, useT, type Key } from '@/app/i18n';
import { Spinner } from '@/components/ui';
import { CHART } from '@/lib/colors';
import { fmtDec, fmtInt, fmtSigma, fmtTempC } from '@/lib/format';
import type { EnsoPhase, EnsoResponse } from '@/lib/types';
import type { Lang } from '@/store';

const SVG_W = 560;
const SVG_H = 200;
const PAD_L = 30;
const PAD_R = 8;
const INNER_W = SVG_W - PAD_L - PAD_R;
const ONI_TOP = 12;
const ONI_BOT = 82;
const ONI_MID = (ONI_TOP + ONI_BOT) / 2;
const FIRE_TOP = 102;
const FIRE_BOT = 172;
const FIRE_MID = (FIRE_TOP + FIRE_BOT) / 2;

function seasonLabel(monthIso: string, lang: Lang): string {
  const [yr, mo] = monthIso.slice(0, 7).split('-').map(Number);
  if (!yr || !mo) return monthIso;
  const prev = monthName((mo + 10) % 12, lang, 'short').replace(/\.$/, '');
  const next = monthName(mo % 12, lang, 'short').replace(/\.$/, '');
  return `${prev}–${next} ${yr}`;
}

function phaseDotClass(phase: EnsoPhase): string {
  if (phase === 'EL_NINO') return 'bg-accent';
  if (phase === 'LA_NINA') return 'bg-viirs';
  return 'bg-ink-mute';
}

export function EnsoPanel({
  aoiName,
  lang,
  data,
  isPending,
  isError,
}: {
  aoiName: string;
  lang: Lang;
  data: EnsoResponse | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const t = useT();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const series = data?.series ?? [];
  const episodes = data?.episodes ?? [];
  const n = series.length;

  const { oniMax, zMax, monthIndex, yearTicks } = useMemo(() => {
    let maxO = 2.6;
    let maxZ = 3.0;
    const idxMap = new Map<string, number>();
    const ticks: { idx: number; year: string }[] = [];
    series.forEach((pt, i) => {
      idxMap.set(pt.month.slice(0, 7), i);
      if (pt.oni != null) maxO = Math.max(maxO, Math.abs(pt.oni));
      if (pt.z != null) maxZ = Math.max(maxZ, Math.abs(pt.z));
      if (pt.month.endsWith('-01-01')) {
        const y = Number(pt.month.slice(0, 4));
        if (y % 5 === 0) ticks.push({ idx: i, year: String(y) });
      }
    });
    return { oniMax: maxO, zMax: maxZ, monthIndex: idxMap, yearTicks: ticks };
  }, [series]);

  const xOf = (i: number) => PAD_L + ((i + 0.5) / Math.max(1, n)) * INNER_W;
  const barW = n > 0 ? Math.max(1, INNER_W / n - 0.35) : 1;
  const halfOniH = (ONI_BOT - ONI_TOP) / 2;
  const halfFireH = (FIRE_BOT - FIRE_TOP) / 2;
  const yOniGuidePos = ONI_MID - (0.5 / oniMax) * halfOniH;
  const yOniGuideNeg = ONI_MID + (0.5 / oniMax) * halfOniH;

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!n || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * SVG_W;
    const rel = (svgX - PAD_L) / INNER_W;
    const idx = Math.min(n - 1, Math.max(0, Math.floor(rel * n)));
    setHoverIdx(idx);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!n) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setHoverIdx((prev) => (prev === null ? 0 : Math.min(n - 1, prev + 1)));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setHoverIdx((prev) => (prev === null ? n - 1 : Math.max(0, prev - 1)));
    } else if (e.key === 'Escape') {
      setHoverIdx(null);
    }
  };

  const cur = data?.current;
  const phaseLabel = cur
    ? (cur.phase === 'EL_NINO' || cur.phase === 'LA_NINA') && cur.strength
      ? t(`enso.phase_${cur.phase}_${cur.strength}` as Key)
      : t(`enso.phase_${cur.phase}` as Key)
    : t('enso.phase_UNKNOWN');

  const countLabel = (months: number) =>
    months === 1 ? t('enso.month_1') : t('enso.months_n', { n: fmtInt(months, lang) });

  const lagLabel = (lag: number) =>
    lag === 0 ? t('enso.lag_0') : lag === 1 ? t('enso.lag_1') : t('enso.lag_n', { n: lag });

  const activePoint = hoverIdx != null && series[hoverIdx] ? series[hoverIdx] : null;
  const activePct = hoverIdx != null && n > 0 ? Math.min(82, Math.max(18, (xOf(hoverIdx) / SVG_W) * 100)) : 50;

  const summarySentence = useMemo(() => {
    if (!data) return '';
    const { impact } = data;
    const elZ = impact.phases.EL_NINO.mean_z;
    const laZ = impact.phases.LA_NINA.mean_z;
    if (impact.r == null || Math.abs(impact.r) < 0.2 || elZ == null || laZ == null) {
      return t('enso.summary_weak', { area: aoiName });
    }
    const elDir = elZ >= 0 ? t('enso.dir_more') : t('enso.dir_less');
    const laDir = laZ >= 0 ? t('enso.dir_more') : t('enso.dir_less');
    const lagPhrase =
      impact.lag_months === 0
        ? t('enso.lag_phrase_0')
        : impact.lag_months === 1
          ? t('enso.lag_phrase_1')
          : t('enso.lag_phrase_n', { n: impact.lag_months });
    return t('enso.summary_strong', {
      area: aoiName,
      elDir,
      el: fmtSigma(elZ, lang, 2),
      laDir,
      la: fmtSigma(laZ, lang, 2),
      lagPhrase,
    });
  }, [data, aoiName, lang, t]);

  return (
    <article className="panel mt-6 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="card-title text-lg">{t('enso.title')}</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-dim">{t('enso.lead')}</p>
        </div>
        {cur && (
          <span className="chip text-ink">
            <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${phaseDotClass(cur.phase)}`} />
            <span>
              {t('enso.now_prefix')} {phaseLabel}
              {cur.oni != null && cur.month && (
                <>
                  {' '}
                  · <span className="data">ONI {fmtTempC(cur.oni, lang, 2)}</span> ({seasonLabel(cur.month, lang)})
                </>
              )}
            </span>
          </span>
        )}
      </div>

      {isError ? (
        <p role="alert" className="mt-4 text-sm text-ink-dim">
          {t('common.error')}
        </p>
      ) : isPending || !data ? (
        <div className="grid h-44 place-items-center">
          <Spinner label={t('common.loading')} />
        </div>
      ) : (
        <>
          <figure className="mt-5">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-dim">
              <div className="flex flex-wrap items-center gap-3">
                <span>{t('enso.band_oni')}</span>
                <span aria-hidden className="text-ink-mute">·</span>
                <span>{t('enso.band_fire')}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
                  {t('enso.phase_EL_NINO')}
                </span>
                <span className="flex items-center gap-1.5">
                  <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-viirs" />
                  {t('enso.phase_LA_NINA')}
                </span>
                <span className="flex items-center gap-1.5">
                  <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm bg-ink-mute/50" />
                  {t('enso.phase_NEUTRAL')}
                </span>
              </div>
            </div>

            <div className="relative">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                tabIndex={0}
                role="img"
                aria-label={t('enso.chart_aria', { area: aoiName })}
                className="block w-full select-none rounded-md outline-none focus-visible:ring-1 focus-visible:ring-accent"
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHoverIdx(null)}
                onBlur={() => setHoverIdx(null)}
                onKeyDown={onKeyDown}
              >
                {/* Episode spans */}
                {episodes.map((ep) => {
                  const i0 = monthIndex.get(ep.start.slice(0, 7));
                  const i1 = monthIndex.get(ep.end.slice(0, 7));
                  if (i0 == null || i1 == null) return null;
                  const x0 = PAD_L + (i0 / Math.max(1, n)) * INNER_W;
                  const x1 = PAD_L + ((i1 + 1) / Math.max(1, n)) * INNER_W;
                  return (
                    <rect
                      key={`${ep.phase}-${ep.start}`}
                      x={x0}
                      y={ONI_TOP}
                      width={Math.max(1, x1 - x0)}
                      height={FIRE_BOT - ONI_TOP}
                      className={ep.phase === 'EL_NINO' ? 'fill-accent opacity-10' : 'fill-viirs opacity-10'}
                    />
                  );
                })}

                {/* Year ticks every 5 years */}
                {yearTicks.map((tk) => {
                  const x = PAD_L + (tk.idx / Math.max(1, n)) * INNER_W;
                  return (
                    <g key={tk.year}>
                      <line x1={x} y1={ONI_TOP} x2={x} y2={FIRE_BOT} stroke={CHART.grid} strokeWidth="1" />
                      <text x={x} y={SVG_H - 6} textAnchor="middle" fontSize="10" className="fill-ink-mute font-mono">
                        {tk.year}
                      </text>
                    </g>
                  );
                })}

                {/* ONI ±0.5 guides and baselines */}
                <line x1={PAD_L} y1={ONI_MID} x2={SVG_W - PAD_R} y2={ONI_MID} stroke={CHART.grid} strokeWidth="1" />
                <line
                  x1={PAD_L}
                  y1={yOniGuidePos}
                  x2={SVG_W - PAD_R}
                  y2={yOniGuidePos}
                  stroke={CHART.axis}
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <line
                  x1={PAD_L}
                  y1={yOniGuideNeg}
                  x2={SVG_W - PAD_R}
                  y2={yOniGuideNeg}
                  stroke={CHART.axis}
                  strokeOpacity="0.45"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
                <line x1={PAD_L} y1={FIRE_MID} x2={SVG_W - PAD_R} y2={FIRE_MID} stroke={CHART.grid} strokeWidth="1" />

                {/* Left axis labels */}
                <text x={PAD_L - 4} y={ONI_MID + 3} textAnchor="end" fontSize="9" className="fill-ink-mute font-mono">
                  °C
                </text>
                <text x={PAD_L - 4} y={ONI_TOP + 8} textAnchor="end" fontSize="8.5" className="fill-ink-mute font-mono">
                  +{Math.round(oniMax)}
                </text>
                <text x={PAD_L - 4} y={ONI_BOT - 2} textAnchor="end" fontSize="8.5" className="fill-ink-mute font-mono">
                  −{Math.round(oniMax)}
                </text>
                <text x={PAD_L - 4} y={FIRE_MID + 3} textAnchor="end" fontSize="9" className="fill-ink-mute font-mono">
                  σ
                </text>
                <text x={PAD_L - 4} y={FIRE_TOP + 8} textAnchor="end" fontSize="8.5" className="fill-ink-mute font-mono">
                  +{Math.round(zMax)}
                </text>
                <text x={PAD_L - 4} y={FIRE_BOT - 2} textAnchor="end" fontSize="8.5" className="fill-ink-mute font-mono">
                  −{Math.round(zMax)}
                </text>

                {/* Monthly bars */}
                {series.map((pt, i) => {
                  const x = PAD_L + (i / Math.max(1, n)) * INNER_W;
                  const oniH = pt.oni != null ? (Math.abs(pt.oni) / oniMax) * halfOniH : 0;
                  const oniY = pt.oni != null && pt.oni >= 0 ? ONI_MID - oniH : ONI_MID;
                  const oniCls =
                    pt.oni == null
                      ? ''
                      : pt.oni >= 0.5
                        ? 'fill-accent'
                        : pt.oni <= -0.5
                          ? 'fill-viirs'
                          : 'fill-ink-mute opacity-35';
                  const zH = pt.z != null ? (Math.abs(pt.z) / zMax) * halfFireH : 0;
                  const zY = pt.z != null && pt.z >= 0 ? FIRE_MID - zH : FIRE_MID;
                  const zCls = pt.z == null ? '' : pt.z >= 0 ? 'fill-accent' : 'fill-viirs';
                  return (
                    <g key={pt.month}>
                      {pt.oni != null && oniH > 0 && <rect x={x} y={oniY} width={barW} height={oniH} className={oniCls} />}
                      {pt.z != null && zH > 0 && <rect x={x} y={zY} width={barW} height={zH} className={zCls} />}
                    </g>
                  );
                })}

                {/* Crosshair */}
                {hoverIdx != null && (
                  <line
                    x1={xOf(hoverIdx)}
                    y1={ONI_TOP}
                    x2={xOf(hoverIdx)}
                    y2={FIRE_BOT}
                    stroke={CHART.axis}
                    strokeWidth="1"
                  />
                )}
              </svg>

              {activePoint && (
                <div
                  role="tooltip"
                  className="panel pointer-events-none absolute top-1 z-20 -translate-x-1/2 px-2.5 py-1.5 text-xs"
                  style={{ left: `${activePct}%` }}
                >
                  <p className="data font-semibold text-ink">{fmtMonth(activePoint.month, lang)}</p>
                  <p className="data text-ink-dim">
                    {t('enso.tooltip_oni')}: {activePoint.oni != null ? fmtTempC(activePoint.oni, lang, 2) : '—'} ·{' '}
                    {t('enso.tooltip_z')}: {activePoint.z != null ? fmtSigma(activePoint.z, lang, 2) : t('common.no_obs')}
                  </p>
                </div>
              )}
            </div>

            <figcaption className="mt-2 text-xs leading-relaxed text-ink-mute">
              {t('enso.chart_caption')} {t('enso.episodes_note')}
            </figcaption>
          </figure>

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-mute">{t('enso.stat_el_nino')}</dt>
              <dd className="data mt-0.5 text-sm text-ink">
                {data.impact.phases.EL_NINO.mean_z != null ? fmtSigma(data.impact.phases.EL_NINO.mean_z, lang, 2) : '—'}{' '}
                <span className="text-xs text-ink-dim">({countLabel(data.impact.phases.EL_NINO.months)})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">{t('enso.stat_la_nina')}</dt>
              <dd className="data mt-0.5 text-sm text-ink">
                {data.impact.phases.LA_NINA.mean_z != null ? fmtSigma(data.impact.phases.LA_NINA.mean_z, lang, 2) : '—'}{' '}
                <span className="text-xs text-ink-dim">({countLabel(data.impact.phases.LA_NINA.months)})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">{t('enso.stat_neutral')}</dt>
              <dd className="data mt-0.5 text-sm text-ink">
                {data.impact.phases.NEUTRAL.mean_z != null ? fmtSigma(data.impact.phases.NEUTRAL.mean_z, lang, 2) : '—'}{' '}
                <span className="text-xs text-ink-dim">({countLabel(data.impact.phases.NEUTRAL.months)})</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-mute">{t('enso.stat_corr')}</dt>
              <dd className="data mt-0.5 text-sm text-ink">
                {data.impact.r != null
                  ? t('enso.corr_val', {
                      r: fmtDec(data.impact.r, lang, 2),
                      lag: lagLabel(data.impact.lag_months),
                    })
                  : '—'}
              </dd>
            </div>
          </dl>

          <p className="mt-3 text-sm leading-relaxed text-ink-dim">{summarySentence}</p>
        </>
      )}
    </article>
  );
}
