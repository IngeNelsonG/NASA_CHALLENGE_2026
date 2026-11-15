import { useT } from '@/app/i18n';
import { calendarKey } from '@/app/loaders';
import { Sparkle } from '@/components/ui';
import { binStart } from '@/features/calendar/CalendarCanvas';
import { APP_NAME, USE_MOCKS } from '@/lib/env';
import { downloadCsv } from '@/lib/worker-client';
import { timelineRange, useAoiName, useStore } from '@/store';
import { useData } from '@/store/data';
import { USTA_URL } from './Team';

type SourceNote = 'data.src_firms' | 'data.src_gibs' | 'data.src_conae' | 'data.src_tle' | 'data.src_ne' | 'data.src_bm';
const SOURCES: { name: string; href: string; note: SourceNote }[] = [
  { name: 'NASA FIRMS', href: 'https://firms.modaps.eosdis.nasa.gov/', note: 'data.src_firms' },
  { name: 'NASA GIBS', href: 'https://worldview.earthdata.nasa.gov/', note: 'data.src_gibs' },
  { name: 'CONAE', href: 'https://www.argentina.gob.ar/ciencia/conae', note: 'data.src_conae' },
  { name: 'CelesTrak', href: 'https://celestrak.org/', note: 'data.src_tle' },
  { name: 'Natural Earth', href: 'https://www.naturalearthdata.com/', note: 'data.src_ne' },
  { name: 'Blue / Black Marble', href: 'https://visibleearth.nasa.gov/', note: 'data.src_bm' },
];
const TEAM_URL = 'https://www.spaceappschallenge.org/2026/find-a-team/ustacode1/?tab=members';

/** Closing block: what the app is, downloads, sources and credits. */
export function Footer() {
  const t = useT();
  const aoi = useStore((s) => s.aoi);
  const aoiName = useAoiName();
  const resolution = useStore((s) => s.resolution);
  const calRange = useStore((s) => s.calRange);
  const date = useStore((s) => s.date);
  const granularity = useStore((s) => s.granularity);
  const count = useData((s) => s.hotspots?.count ?? 0);
  const slug = aoi.id.replace(/[^a-z0-9-]+/gi, '_');
  const range = timelineRange(date, granularity);
  const base = import.meta.env.BASE_URL;

  return (
    <footer id="data" className="frame" aria-labelledby="footer-title">
      <div className="window px-5 pb-6 pt-12 sm:px-8 lg:px-12 lg:pt-16 xl:pl-24">
        {/* brand + downloads */}
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-16">
          <div>
            <p id="footer-title" className="flex items-center gap-2 font-display text-4xl text-cream">
              <Sparkle className="h-5 w-5 text-accent" />
              {APP_NAME}
            </p>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-dim">{t('footer.about')}</p>
          </div>

          <div>
            <h2 className="eyebrow">{t('data.download')}</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                className="btn justify-between text-left"
                title={`${calRange.from} → ${calRange.to}`}
                onClick={() => void downloadCsv({ kind: 'calendar', key: calendarKey(aoi.id, resolution), from: binStart(calRange.from, resolution), to: calRange.to }, `calendar_${slug}_${resolution}_${calRange.from}_${calRange.to}.csv`)}
              >
                <span className="min-w-0 truncate">{t('data.csv_calendar', { aoi: aoiName })}</span>
                <span aria-hidden className="shrink-0 text-ink-dim">↓</span>
              </button>
              <button
                type="button"
                className="btn justify-between text-left"
                disabled={!count}
                title={range.from === range.to ? range.from : `${range.from} → ${range.to}`}
                onClick={() => void downloadCsv({ kind: 'hotspots' }, `hotspots_${slug}_${range.from}_${range.to}.csv`)}
              >
                <span className="min-w-0 truncate">{t('data.csv_hotspots')}</span>
                <span aria-hidden className="shrink-0 text-ink-dim">↓</span>
              </button>
            </div>
            <p className="mt-2 text-xs text-ink-mute">{USE_MOCKS ? t('data.mock_note') : t('data.download_lead')}</p>
          </div>
        </div>

        {/* sources + logos */}
        <div className="mt-12 flex flex-col gap-6 border-t border-line pt-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="eyebrow">{t('data.sources')}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {SOURCES.map((s) => (
                <li key={s.name}>
                  <a href={s.href} target="_blank" rel="noreferrer" title={t(s.note)} className="chip-btn text-ink">
                    {s.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 items-center gap-5">
            <img src={`${base}brand/space-apps-logo.png`} alt="NASA Space Apps Challenge" width={440} height={172} loading="lazy" className="h-auto w-32" />
            <a href={USTA_URL} target="_blank" rel="noreferrer" title="santototunja.edu.co" className="shrink-0 rounded-full transition-transform duration-300 hover:scale-105">
              <img src={`${base}brand/usta-logo.png`} alt="Universidad Santo Tomás (santototunja.edu.co)" width={280} height={280} loading="lazy" className="h-12 w-12 rounded-full bg-white object-cover" />
            </a>
          </div>
        </div>

        {/* credits */}
        <div className="mt-8 flex flex-col gap-2 text-xs leading-relaxed text-ink-mute sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 USTACODE · NASA Space Apps Challenge</p>
          <a href={TEAM_URL} target="_blank" rel="noreferrer" className="tap inline-flex items-center gap-1.5 hover:text-ink">
            {t('footer.team')} <span aria-hidden>↗</span>
          </a>
        </div>
        <p className="mt-3 max-w-4xl text-[0.8125rem] leading-relaxed text-ink-mute/80">{t('data.ack')}</p>
      </div>
    </footer>
  );
}
