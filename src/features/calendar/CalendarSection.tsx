import { useMemo, useState } from 'react';
import { fmtInt, monthName, useT } from '@/app/i18n';
import { calendarKey, useCalendar } from '@/app/loaders';
import { SectionHeading, Segmented, Spinner } from '@/components/ui';
import { fireGradientCss, NODATA_BG, NODATA_STROKE, ZERO_COLOR } from '@/lib/colors';
import { RECORD_START } from '@/lib/env';
import { todayIso } from '@/lib/geo';
import type { CalendarCell, Resolution } from '@/lib/types';
import { downloadCsv } from '@/lib/worker-client';
import { useStore, type DateRange } from '@/store';
import { binStart, CalendarCanvas } from './CalendarCanvas';

const hatchCss = `repeating-linear-gradient(135deg, ${NODATA_BG} 0 3px, ${NODATA_STROKE} 3px 4px)`;

function Legend({ max }: { max: number }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  // ticks on the square-root colour scale
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => ({ f, v: max * f * f }));
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 text-xs text-ink-dim">
      <div className="w-56">
        <p className="mb-1">
          {t('cal.legend_harmonized')}
        </p>
        <div aria-hidden className="h-2.5 rounded-sm" style={{ background: fireGradientCss }} />
        <div className="data relative mt-0.5 h-3 text-[10px]" aria-hidden>
          <span className="absolute left-0">1</span>
          {ticks.map((k) => (
            <span key={k.f} className="absolute -translate-x-full" style={{ left: `${k.f * 100}%` }}>
              {k.f === 1 ? '≥ ' : ''}
              {fmtInt(k.v, lang)}
            </span>
          ))}
        </div>
      </div>
      <span className="flex items-center gap-1.5">
        <i aria-hidden className="inline-block h-3 w-3 rounded-sm border border-line" style={{ background: ZERO_COLOR }} /> {t('cal.legend_zero')}
      </span>
      <span className="flex items-center gap-1.5">
        <i aria-hidden className="inline-block h-3 w-3 rounded-sm border border-line" style={{ background: hatchCss }} /> {t('common.no_obs')}
      </span>
      <span className="flex items-center gap-1.5">
        <i aria-hidden className="inline-block h-0.5 w-4 bg-harmonized" />
        <i aria-hidden className="inline-block h-3 w-4 bg-harmonized/20" /> {t('cal.legend_clim')}
      </span>
    </div>
  );
}

/** Year × month totals: the screen-reader / "view as table" alternative to the canvas. */
function YearMonthTable({ cells, range, visible }: { cells: CalendarCell[]; range: DateRange; visible: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const rows = useMemo(() => {
    const m = new Map<number, (number | null)[]>();
    const lo = binStart(range.from, 'month');
    for (const c of cells) {
      if (c.date < lo || c.date > range.to) continue;
      const y = +c.date.slice(0, 4);
      const row = m.get(y) ?? m.set(y, Array<number | null>(12).fill(null)).get(y)!;
      row[+c.date.slice(5, 7) - 1] = c.harmonized;
    }
    return [...m.entries()];
  }, [cells, range.from, range.to]);
  return (
    <div className={visible ? 'mt-4 max-h-[420px] overflow-auto rounded-lg border border-line' : 'sr-only'}>
      <table className="data w-full border-collapse text-right text-[11px]">
        <caption className="sr-only">{t('cal.table_caption', { series: t('series.harmonized') })}</caption>
        <thead className="sticky top-0 bg-space-800 text-ink-dim">
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left">{t('time.year')}</th>
            {Array.from({ length: 12 }, (_, i) => (
              <th key={i} scope="col" className="px-2 py-1.5 font-normal">{monthName(i, lang)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([y, r]) => (
            <tr key={y} className="border-t border-line/60">
              <th scope="row" className="px-2 py-1 text-left text-ink">{y}</th>
              {r.map((v, i) => (
                <td key={i} className={`px-2 py-1 ${v === null ? 'text-ink-mute' : 'text-ink'}`}>
                  {v === null ? <abbr title={t('common.no_obs')}>—</abbr> : fmtInt(v, lang)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const shiftYears = (iso: string, n: number) => `${+iso.slice(0, 4) + n}${iso.slice(4)}`;

/** The only data filter in the app: which dates the calendar shows. */
function DateFilter({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const t = useT();
  const today = todayIso();
  const year = +today.slice(0, 4);
  const presets: { label: string; r: DateRange }[] = [
    { label: t('cal.preset_all'), r: { from: RECORD_START, to: today } },
    { label: t('cal.preset_10'), r: { from: `${year - 9}-01-01`, to: today } },
    { label: t('cal.preset_5'), r: { from: `${year - 4}-01-01`, to: today } },
    { label: t('cal.preset_12m'), r: { from: shiftYears(today, -1), to: today } },
  ];
  const isAll = range.from === RECORD_START && range.to === today;
  return (
    <fieldset className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-space-900/50 p-3">
      <legend className="px-1 text-xs font-semibold text-ink">{t('cal.filter')}</legend>
      <label className="text-xs text-ink-dim">
        {t('cal.from')}
        <input
          type="date"
          className="input data mt-1 !w-[10.5rem] [color-scheme:dark]"
          min={RECORD_START}
          max={range.to}
          value={range.from}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to: range.to })}
        />
      </label>
      <label className="text-xs text-ink-dim">
        {t('cal.to')}
        <input
          type="date"
          className="input data mt-1 !w-[10.5rem] [color-scheme:dark]"
          min={range.from}
          max={today}
          value={range.to}
          onChange={(e) => e.target.value && onChange({ from: range.from, to: e.target.value })}
        />
      </label>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('cal.presets')}>
        {presets.map((p) => {
          const on = p.r.from === range.from && p.r.to === range.to;
          return (
            <button key={p.label} type="button" aria-pressed={on} onClick={() => onChange(p.r)} className={`btn !min-h-[36px] !px-2.5 !text-xs ${on ? 'btn-primary' : ''}`}>
              {p.label}
            </button>
          );
        })}
      </div>
      {!isAll && <p className="w-full text-[11px] text-ink-mute">{t('cal.filter_note')}</p>}
    </fieldset>
  );
}

export default function CalendarSection() {
  const t = useT();
  const aoi = useStore((s) => s.aoi);
  const range = useStore((s) => s.calRange);
  const setCalRange = useStore((s) => s.setCalRange);
  const resolution = useStore((s) => s.resolution);
  const date = useStore((s) => s.date);
  const highlights = useStore((s) => s.highlights);
  const set = useStore((s) => s.set);
  const [table, setTable] = useState(false);

  const q = useCalendar(resolution);
  const monthly = useCalendar('month');
  const highlightDates = useMemo(() => highlights.map((h) => h.date), [highlights]);
  const data = q.data && q.data.response.aoi.id === aoi.id ? q.data : undefined;

  const onSelect = (c: CalendarCell) =>
    useStore.getState().focusDate(c.date, resolution === 'month' ? 'month' : resolution === 'week' ? 'month' : 'day');

  return (
    <section id="calendar" className="section" aria-labelledby="calendar-title">
      <SectionHeading id="calendar-title" eyebrow={t('cal.eyebrow')} title={t('cal.title')} lead={t('cal.lead', { aoi: aoi.name })} />
      <div className="panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<Resolution>
            label={t('cal.resolution')}
            value={resolution}
            onChange={(v) => set({ resolution: v })}
            options={[
              { value: 'day', label: t('time.day') },
              { value: 'week', label: t('cal.week') },
              { value: 'month', label: t('time.month') },
            ]}
          />
          <span className="chip border-harmonized/50 text-ink">MODIS + VIIRS · ≈ {t('common.estimate')}</span>
          {q.isFetching && <Spinner label={t('common.loading')} />}
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn" aria-pressed={table} onClick={() => setTable((v) => !v)}>
              {t(table ? 'cal.hide_table' : 'cal.show_table')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!data}
              onClick={() => void downloadCsv({ kind: 'calendar', key: calendarKey(aoi.id, resolution), from: binStart(range.from, resolution), to: range.to }, `calendar_${aoi.id.replace(/[^a-z0-9-]+/gi, '_')}_${resolution}_${range.from}_${range.to}.csv`)}
            >
              <span aria-hidden>↓</span> CSV
            </button>
          </span>
        </div>

        <DateFilter range={range} onChange={setCalRange} />

        <p className="mt-4 text-xs text-ink-dim">{t('cal.clim_caption')}</p>
        <div className="mt-1">
          {q.isError ? (
            <div role="alert" className="grid min-h-[300px] place-items-center text-sm text-ink-dim">
              <div className="text-center">
                <p>{t('common.error')}</p>
                <button type="button" className="btn mt-3" onClick={() => void q.refetch()}>
                  {t('common.retry')}
                </button>
              </div>
            </div>
          ) : data ? (
            <CalendarCanvas data={data} range={range} resolution={resolution} selectedDate={date} highlightDates={highlightDates} onSelect={onSelect} />
          ) : (
            <div className="grid min-h-[480px] place-items-center">
              <Spinner label={t('common.loading')} />
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-line pt-4">{data && <Legend max={data.domain.harmonized} />}</div>
        <p className="mt-3 text-xs leading-relaxed text-ink-mute">
          {t('cal.howto')} {data && <span className="data">· {data.response.meta.method} · v{data.response.meta.version}</span>}
        </p>
        {monthly.data && <YearMonthTable cells={monthly.data.response.cells} range={range} visible={table} />}
      </div>
    </section>
  );
}
