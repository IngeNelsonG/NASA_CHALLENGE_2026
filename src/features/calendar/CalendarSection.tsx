import { useMemo, useState } from 'react';
import { fmtInt, monthName, useT } from '@/app/i18n';
import { calendarKey, useCalendar } from '@/app/loaders';
import { SectionHeading, Segmented, Spinner } from '@/components/ui';
import { fireGradientCss, NODATA_BG, NODATA_STROKE, ZERO_COLOR } from '@/lib/colors';
import type { CalendarCell, Resolution, Sensor } from '@/lib/types';
import { downloadCsv } from '@/lib/worker-client';
import { useStore } from '@/store';
import { CalendarCanvas } from './CalendarCanvas';

const hatchCss = `repeating-linear-gradient(135deg, ${NODATA_BG} 0 3px, ${NODATA_STROKE} 3px 4px)`;

function Legend({ max, series }: { max: number; series: Sensor }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  // ticks on the square-root colour scale
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => ({ f, v: max * f * f }));
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3 text-xs text-ink-dim">
      <div className="w-56">
        <p className="mb-1">
          {t(series === 'harmonized' ? 'cal.legend_harmonized' : 'cal.legend_raw')}
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
function YearMonthTable({ cells, series, visible }: { cells: CalendarCell[]; series: Sensor; visible: boolean }) {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const rows = useMemo(() => {
    const m = new Map<number, (number | null)[]>();
    for (const c of cells) {
      const y = +c.date.slice(0, 4);
      const row = m.get(y) ?? m.set(y, Array<number | null>(12).fill(null)).get(y)!;
      row[+c.date.slice(5, 7) - 1] = c[series];
    }
    return [...m.entries()];
  }, [cells, series]);
  return (
    <div className={visible ? 'mt-4 max-h-[420px] overflow-auto rounded-lg border border-line' : 'sr-only'}>
      <table className="data w-full border-collapse text-right text-[11px]">
        <caption className="sr-only">{t('cal.table_caption', { series: t(`series.${series}`) })}</caption>
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

export default function CalendarSection() {
  const t = useT();
  const aoi = useStore((s) => s.aoi);
  const series = useStore((s) => s.series);
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
          <Segmented<Sensor>
            label={t('cal.series')}
            value={series}
            onChange={(v) => set({ series: v })}
            options={[
              { value: 'harmonized', label: t('series.harmonized') },
              { value: 'modis', label: t('series.modis') },
              { value: 'viirs', label: t('series.viirs') },
            ]}
          />
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
          {series === 'harmonized' && <span className="chip border-harmonized/50 text-ink">≈ {t('common.estimate')}</span>}
          {q.isFetching && <Spinner label={t('common.loading')} />}
          <span className="ml-auto flex gap-2">
            <button type="button" className="btn" aria-pressed={table} onClick={() => setTable((v) => !v)}>
              {t(table ? 'cal.hide_table' : 'cal.show_table')}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!data}
              onClick={() => void downloadCsv({ kind: 'calendar', key: calendarKey(aoi.id, resolution) }, `calendar_${aoi.id.replace(/[^a-z0-9-]+/gi, '_')}_${resolution}.csv`)}
            >
              <span aria-hidden>↓</span> CSV
            </button>
          </span>
        </div>

        <p className="mt-4 text-xs text-ink-dim">{t('cal.clim_caption')}</p>
        <div className="mt-1 min-h-[480px]">
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
            <CalendarCanvas data={data} series={series} resolution={resolution} selectedDate={date} highlightDates={highlightDates} onSelect={onSelect} />
          ) : (
            <div className="grid min-h-[480px] place-items-center">
              <Spinner label={t('common.loading')} />
            </div>
          )}
        </div>

        <div className="mt-4 border-t border-line pt-4">{data && <Legend max={data.domain[series]} series={series} />}</div>
        <p className="mt-3 text-xs leading-relaxed text-ink-mute">
          {t('cal.howto')} {data && <span className="data">· {data.response.meta.method} · v{data.response.meta.version}</span>}
        </p>
        {monthly.data && <YearMonthTable cells={monthly.data.response.cells} series={series} visible={table} />}
      </div>
    </section>
  );
}
