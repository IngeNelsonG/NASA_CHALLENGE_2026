import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { fmtDay, fmtInt, fmtMonth, monthName, useT } from '@/app/i18n';
import { fireColor, noDataPattern, SENSOR_COLOR } from '@/lib/colors';
import { doyOf, yearStartIdx } from '@/lib/geo';
import type { CalendarCell, CalendarData, Resolution } from '@/lib/types';
import { useStore, type DateRange } from '@/store';

/** Both sensors are always combined: the grid shows the harmonized series, the tooltip shows each sensor. */
const SERIES = 'harmonized' as const;
const COLS: Record<Resolution, number> = { day: 366, week: 53, month: 12 };
const GUTTER_L = 40;
const CLIM_H = 58;
const AXIS_H = 18;

const colOf = (iso: string, res: Resolution) => (res === 'month' ? +iso.slice(5, 7) - 1 : res === 'week' ? Math.floor((doyOf(iso) - 1) / 7) : doyOf(iso) - 1);
/** column where each month starts (leap-year frame) */
const monthStartCol = (m: number, res: Resolution) => {
  if (res === 'month') return m;
  const doy0 = Math.floor(Date.UTC(2000, m, 1) / 86_400_000) - yearStartIdx(2000);
  return res === 'week' ? doy0 / 7 : doy0;
};

type Props = {
  data: CalendarData;
  resolution: Resolution;
  /** date filter: rows outside it are not drawn, cells outside it are left empty */
  range: DateRange;
  selectedDate: string;
  highlightDates: string[];
  onSelect: (cell: CalendarCell) => void;
};

/**
 * Fire-activity calendar on a single canvas: years down, days/weeks/months across, with the
 * climatological profile on top. "No observation" is hatched and never drawn as zero.
 */
/** first day of the bin that contains `iso` */
export function binStart(iso: string, res: Resolution): string {
  if (res === 'day') return iso;
  if (res === 'month') return `${iso.slice(0, 7)}-01`;
  const y = +iso.slice(0, 4);
  const d = new Date(Date.UTC(y, 0, 1 + Math.floor((doyOf(iso) - 1) / 7) * 7));
  return d.toISOString().slice(0, 10);
}

export function CalendarCanvas({ data, resolution, range, selectedDate, highlightDates, onSelect }: Props) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<{ year: number; col: number; kb: boolean } | null>(null);

  const cols = COLS[resolution];
  const Y0 = +range.from.slice(0, 4);
  const yearNow = +range.to.slice(0, 4);
  const years = yearNow - Y0 + 1;
  const rowH = resolution === 'month' ? 20 : 15;
  const gap = resolution === 'day' ? 0 : 2;
  const rowGap = 2;
  const cellW = Math.max(0.5, (width - GUTTER_L) / cols);
  const gridTop = CLIM_H + AXIS_H;
  const height = gridTop + years * (rowH + rowGap);

  const index = useMemo(() => {
    const m = new Map<number, CalendarCell>();
    const lo = binStart(range.from, resolution);
    for (const c of data.response.cells) {
      if (c.date < lo || c.date > range.to) continue;
      m.set(+c.date.slice(0, 4) * 1000 + colOf(c.date, resolution), c);
    }
    return m;
  }, [data, resolution, range.from, range.to]);
  const cellAt = useCallback((year: number, col: number) => index.get(year * 1000 + col), [index]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || width < 50) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(width * dpr);
    cv.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const max = data.domain[SERIES];
    const hatch = noDataPattern(ctx);
    const x = (col: number) => GUTTER_L + col * cellW;
    const y = (year: number) => gridTop + (year - Y0) * (rowH + rowGap);
    const mono = '10px "Overpass Mono", ui-monospace, monospace';

    // climatology (always of the harmonised series): p10–p90 band + mean
    const clim = data.response.climatology.map((c) => ({ ...c, col: resolution === 'month' ? new Date(Date.UTC(2000, 0, c.doy)).getUTCMonth() : resolution === 'week' ? Math.floor((c.doy - 1) / 7) : c.doy - 1 }));
    const cMax = Math.max(1, ...clim.map((c) => c.p90));
    const cy = (v: number) => CLIM_H - 6 - (v / cMax) * (CLIM_H - 18);
    const cx = (col: number) => x(col) + cellW / 2;
    if (clim.length > 1) {
      ctx.beginPath();
      clim.forEach((c, i) => (i ? ctx.lineTo(cx(c.col), cy(c.p90)) : ctx.moveTo(cx(c.col), cy(c.p90))));
      for (let i = clim.length - 1; i >= 0; i--) ctx.lineTo(cx(clim[i].col), cy(clim[i].p10));
      ctx.closePath();
      ctx.fillStyle = 'rgba(227,182,47,0.20)';
      ctx.fill();
      ctx.beginPath();
      clim.forEach((c, i) => (i ? ctx.lineTo(cx(c.col), cy(c.mean)) : ctx.moveTo(cx(c.col), cy(c.mean))));
      ctx.strokeStyle = SENSOR_COLOR.harmonized;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(148,170,220,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(GUTTER_L, CLIM_H - 5.5);
    ctx.lineTo(width, CLIM_H - 5.5);
    ctx.stroke();
    ctx.font = mono;
    ctx.fillStyle = '#A9B4CC';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillText(fmtInt(cMax, lang), GUTTER_L - 6, cy(cMax));
    ctx.fillText('0', GUTTER_L - 6, cy(0));

    // month axis
    ctx.textAlign = 'left';
    for (let m = 0; m < 12; m++) {
      const mx = x(monthStartCol(m, resolution));
      ctx.fillStyle = '#A9B4CC';
      ctx.fillText(monthName(m, lang, cellW * cols < 520 ? 'narrow' : 'short'), mx + 2, CLIM_H + AXIS_H / 2);
      if (m && resolution !== 'month') {
        ctx.fillStyle = 'rgba(148,170,220,0.16)';
        ctx.fillRect(Math.round(mx) - 0.5, CLIM_H - 5, 1, height);
      }
    }

    // grid
    const w = Math.max(0.5, cellW - gap);
    for (let yr = Y0; yr <= yearNow; yr++) {
      ctx.fillStyle = yr % 5 === 0 ? '#E8EDF7' : '#7C89A6';
      ctx.textAlign = 'right';
      ctx.fillText(String(yr), GUTTER_L - 6, y(yr) + rowH / 2 + 0.5);
      for (let c = 0; c < cols; c++) {
        const cell = cellAt(yr, c);
        if (!cell) continue;
        const v = cell[SERIES];
        ctx.fillStyle = v === null ? hatch : fireColor(v, max);
        ctx.fillRect(x(c), y(yr), w + (gap ? 0 : 0.4), rowH);
      }
    }

    // markers: analyst highlights, selected date, focus
    const outline = (iso: string, color: string, lw: number) => {
      const yr = +iso.slice(0, 4);
      if (yr < Y0 || yr > yearNow) return;
      const c = colOf(iso, resolution);
      const ow = Math.max(4, w);
      ctx.strokeStyle = '#04070F';
      ctx.lineWidth = lw + 2;
      ctx.strokeRect(x(c) - 1, y(yr) - 1, ow + 2, rowH + 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.strokeRect(x(c) - 1, y(yr) - 1, ow + 2, rowH + 2);
    };
    for (const d of highlightDates) outline(d, '#EAFE07', 1.5);
    if (selectedDate) outline(selectedDate, '#ffffff', 1.5);
    if (focus) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x(focus.col) - 1.5, y(focus.year) - 1.5, Math.max(4, w) + 3, rowH + 3);
    }
  }, [data, resolution, width, height, cellW, cols, gap, rowH, gridTop, Y0, yearNow, cellAt, selectedDate, highlightDates, focus, lang]);

  const hit = (e: MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left - GUTTER_L) / cellW);
    const year = Y0 + Math.floor((e.clientY - r.top - gridTop) / (rowH + rowGap));
    return col >= 0 && col < cols && year >= Y0 && year <= yearNow && cellAt(year, col) ? { year, col } : null;
  };

  const onKey = (e: KeyboardEvent) => {
    const f = focus ?? { year: +selectedDate.slice(0, 4) || yearNow, col: colOf(selectedDate, resolution), kb: true };
    let { year, col } = f;
    if (e.key === 'ArrowLeft') col--;
    else if (e.key === 'ArrowRight') col++;
    else if (e.key === 'ArrowUp') year--;
    else if (e.key === 'ArrowDown') year++;
    else if (e.key === 'Home') col = 0;
    else if (e.key === 'End') col = cols - 1;
    else if (e.key === 'Enter' || e.key === ' ') {
      const c = cellAt(f.year, f.col);
      if (c) onSelect(c);
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    if (col < 0) (col = cols - 1), year--;
    if (col >= cols) (col = 0), year++;
    year = Math.max(Y0, Math.min(yearNow, year));
    // skip slots that do not exist (future dates, day 366 of a common year)
    while (!cellAt(year, col) && col > 0) col--;
    setFocus({ year, col, kb: true });
  };

  const cell = focus ? cellAt(focus.year, focus.col) : undefined;
  const dateLabel = (c: CalendarCell) => (resolution === 'month' ? fmtMonth(c.date, lang) : resolution === 'week' ? t('cal.week_of', { date: fmtDay(c.date, lang) }) : fmtDay(c.date, lang));
  const obs = (v: number | null) => (v === null ? t('common.no_obs') : fmtInt(v, lang));
  const zText = (z: number) => `${z > 0 ? '+' : ''}${z.toFixed(1)} σ · ${t(Math.abs(z) < 1 ? 'cal.z_normal' : z > 0 ? (z >= 2 ? 'cal.z_far_above' : 'cal.z_above') : z <= -2 ? 'cal.z_far_below' : 'cal.z_below')}`;

  const tipX = focus ? GUTTER_L + (focus.col + 0.5) * cellW : 0;
  const tipY = focus ? gridTop + (focus.year - Y0) * (rowH + rowGap) : 0;
  const flipX = tipX > width - 250;
  const flipY = tipY > height - 190;

  return (
    <div ref={wrap} className="relative">
      <canvas
        ref={canvas}
        style={{ width: '100%', height }}
        tabIndex={0}
        role="application"
        aria-label={t('cal.aria')}
        aria-describedby="cal-live"
        className="block cursor-pointer rounded-md"
        onMouseMove={(e) => {
          const h = hit(e);
          if (h?.year !== focus?.year || h?.col !== focus?.col) setFocus(h ? { ...h, kb: false } : null);
        }}
        onMouseLeave={() => setFocus((f) => (f?.kb ? f : null))}
        onClick={(e) => {
          const h = hit(e);
          const c = h && cellAt(h.year, h.col);
          if (c) onSelect(c);
        }}
        onKeyDown={onKey}
        onBlur={() => setFocus(null)}
      />
      {cell && focus && (
        <div
          role="tooltip"
          className="panel pointer-events-none absolute z-20 w-[236px] p-3 text-xs"
          style={{ left: flipX ? tipX - 246 : tipX + 12, top: flipY ? tipY - 150 : tipY + rowH + 8 }}
        >
          <p className="data text-sm font-semibold text-ink">{dateLabel(cell)}</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-dim">
            <dt className="flex items-center gap-1.5">
              <i aria-hidden className="inline-block h-2 w-2 rounded-full bg-modis" /> MODIS
            </dt>
            <dd className="data text-right text-ink">{obs(cell.modis)}</dd>
            <dt className="flex items-center gap-1.5">
              <i aria-hidden className="inline-block h-2 w-2 rounded-full bg-viirs" /> VIIRS
            </dt>
            <dd className="data text-right text-ink">{obs(cell.viirs)}</dd>
            <dt className="flex items-center gap-1.5">
              <i aria-hidden className="inline-block h-2 w-2 rounded-full bg-harmonized" /> {t('series.harmonized')}
            </dt>
            <dd className="data text-right text-ink">
              {cell.harmonized === null ? (
                t('common.no_obs')
              ) : (
                <>
                  ≈ {fmtInt(cell.harmonized, lang)}
                  {cell.harmonizedLow !== undefined && cell.harmonizedHigh !== undefined && (
                    <span className="text-ink-dim">
                      {' '}
                      ({fmtInt(cell.harmonizedLow, lang)}–{fmtInt(cell.harmonizedHigh, lang)})
                    </span>
                  )}
                </>
              )}
            </dd>
            {cell.frp !== undefined && (
              <>
                <dt>{t('cal.frp')}</dt>
                <dd className="data text-right text-ink">{fmtInt(cell.frp, lang)} MW</dd>
              </>
            )}
            {cell.anomalyZ !== undefined && (
              <>
                <dt>{t('cal.anomaly')}</dt>
                <dd className="data text-right text-ink">{zText(cell.anomalyZ)}</dd>
              </>
            )}
          </dl>
          {cell.harmonized !== null && <p className="mt-2 text-[11px] leading-snug text-ink-mute">{t('cal.estimate_note')}</p>}
        </div>
      )}
      <p id="cal-live" aria-live="polite" className="sr-only">
        {cell && focus?.kb
          ? `${dateLabel(cell)}. MODIS ${obs(cell.modis)}. VIIRS ${obs(cell.viirs)}. ${t('series.harmonized')} ${cell.harmonized === null ? t('common.no_obs') : `${fmtInt(cell.harmonized, lang)}, ${fmtInt(cell.harmonizedLow ?? 0, lang)}–${fmtInt(cell.harmonizedHigh ?? 0, lang)}`}. ${cell.anomalyZ !== undefined ? zText(cell.anomalyZ) : ''}`
          : ''}
      </p>
    </div>
  );
}
