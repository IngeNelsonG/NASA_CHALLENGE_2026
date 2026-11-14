import { useT } from '@/app/i18n';
import { calendarKey } from '@/app/loaders';
import { SectionHeading } from '@/components/ui';
import { APP_NAME, USE_MOCKS } from '@/lib/env';
import { downloadCsv } from '@/lib/worker-client';
import { binStart } from '@/features/calendar/CalendarCanvas';
import { timelineRange, useStore } from '@/store';
import { useData } from '@/store/data';

const SOURCES: { name: string; href: string; note: 'data.src_firms' | 'data.src_conae' | 'data.src_tle' | 'data.src_ne' | 'data.src_bm' }[] = [
  { name: 'NASA FIRMS / LANCE', href: 'https://firms.modaps.eosdis.nasa.gov/', note: 'data.src_firms' },
  { name: 'CONAE', href: 'https://www.argentina.gob.ar/ciencia/conae', note: 'data.src_conae' },
  { name: 'CelesTrak', href: 'https://celestrak.org/', note: 'data.src_tle' },
  { name: 'Natural Earth', href: 'https://www.naturalearthdata.com/', note: 'data.src_ne' },
  { name: 'NASA Blue Marble / Black Marble', href: 'https://visibleearth.nasa.gov/', note: 'data.src_bm' },
];

export function Credits() {
  const t = useT();
  const aoi = useStore((s) => s.aoi);
  const resolution = useStore((s) => s.resolution);
  const calRange = useStore((s) => s.calRange);
  const date = useStore((s) => s.date);
  const granularity = useStore((s) => s.granularity);
  const count = useData((s) => s.hotspots?.count ?? 0);
  const slug = aoi.id.replace(/[^a-z0-9-]+/gi, '_');
  const range = timelineRange(date, granularity);

  return (
    <section id="data" className="section" aria-labelledby="data-title">
      <SectionHeading id="data-title" eyebrow={t('data.eyebrow')} title={t('data.title')} />
      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <article className="panel p-4 sm:p-5">
          <h3 className="text-lg font-semibold">{t('data.sources')}</h3>
          <ul className="mt-3 space-y-3 text-sm">
            {SOURCES.map((s) => (
              <li key={s.name}>
                <a href={s.href} target="_blank" rel="noreferrer" className="font-semibold text-brand-yonder underline-offset-2 hover:underline">
                  {s.name}
                </a>
                <span className="text-ink-dim"> — {t(s.note)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-ink-mute">{t('data.ack')}</p>
        </article>
        <article className="panel p-4 sm:p-5">
          <h3 className="text-lg font-semibold">{t('data.download')}</h3>
          <p className="mt-2 text-sm text-ink-dim">{t('data.download_lead')}</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" className="btn justify-between" onClick={() => void downloadCsv({ kind: 'calendar', key: calendarKey(aoi.id, resolution), from: binStart(calRange.from, resolution), to: calRange.to }, `calendar_${slug}_${resolution}_${calRange.from}_${calRange.to}.csv`)}>
              <span>{t('data.csv_calendar', { aoi: aoi.name })}</span>
              <span className="data text-xs text-ink-dim">
                {calRange.from} → {calRange.to} · {resolution} · CSV ↓
              </span>
            </button>
            <button type="button" className="btn justify-between" disabled={!count} onClick={() => void downloadCsv({ kind: 'hotspots' }, `hotspots_${slug}_${range.from}_${range.to}.csv`)}>
              <span>{t('data.csv_hotspots')}</span>
              <span className="data text-xs text-ink-dim">
                {range.from === range.to ? range.from : `${range.from} → ${range.to}`} · CSV ↓
              </span>
            </button>
          </div>
          {USE_MOCKS && <p className="mt-3 text-xs text-ink-mute">{t('data.mock_note')}</p>}
        </article>
      </div>
      <footer className="mt-10 border-t border-line pt-6 text-xs leading-relaxed text-ink-mute">
        <p>
          {APP_NAME} · NASA Space Apps Challenge 2026 · “Harmonization of MODIS and VIIRS Hot Spots”. {t('data.footer')}
        </p>
      </footer>
    </section>
  );
}
