import { useT } from '@/app/i18n';
import { calendarKey } from '@/app/loaders';
import { RollText, Sparkle } from '@/components/ui';
import { binStart } from '@/features/calendar/CalendarCanvas';
import { APP_NAME, USE_MOCKS } from '@/lib/env';
import { downloadCsv } from '@/lib/worker-client';
import { timelineRange, useStore } from '@/store';
import { useData } from '@/store/data';
import { SECTIONS } from './OrbitNav';

type SourceNote = 'data.src_firms' | 'data.src_gibs' | 'data.src_conae' | 'data.src_tle' | 'data.src_ne' | 'data.src_bm';
const SOURCES: { name: string; href: string; note: SourceNote }[] = [
  { name: 'NASA FIRMS / LANCE', href: 'https://firms.modaps.eosdis.nasa.gov/', note: 'data.src_firms' },
  { name: 'NASA GIBS / Worldview', href: 'https://worldview.earthdata.nasa.gov/', note: 'data.src_gibs' },
  { name: 'CONAE', href: 'https://www.argentina.gob.ar/ciencia/conae', note: 'data.src_conae' },
  { name: 'CelesTrak', href: 'https://celestrak.org/', note: 'data.src_tle' },
  { name: 'Natural Earth', href: 'https://www.naturalearthdata.com/', note: 'data.src_ne' },
  { name: 'NASA Blue Marble / Black Marble', href: 'https://visibleearth.nasa.gov/', note: 'data.src_bm' },
];
const TEAM_URL = 'https://www.spaceappschallenge.org/2026/find-a-team/ustacode1/?tab=members';

/** Closing block: what the app is, where the data comes from, downloads, credits. */
export function Footer() {
  const t = useT();
  const aoi = useStore((s) => s.aoi);
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
        <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr_1.2fr] lg:gap-12">
          {/* about */}
          <div>
            <p id="footer-title" className="flex items-center gap-2 font-display text-3xl text-cream">
              <Sparkle className="h-5 w-5 text-accent" />
              {APP_NAME}
            </p>
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-dim">{t('footer.about')}</p>
            <div className="mt-6 flex items-center gap-5">
              <img src={`${base}brand/space-apps-logo.png`} alt="NASA Space Apps Challenge" width={440} height={172} loading="lazy" className="h-auto w-36" />
              <img src={`${base}brand/usta-logo.png`} alt="Universidad Santo Tomás" width={280} height={280} loading="lazy" className="h-14 w-14 rounded-full bg-white object-cover" />
            </div>
            <a href={TEAM_URL} target="_blank" rel="noreferrer" className="tap mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline-offset-4 hover:underline">
              {t('footer.team')} <span aria-hidden>↗</span>
            </a>
          </div>

          {/* sources */}
          <div>
            <h2 className="eyebrow">{t('data.sources')}</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {SOURCES.map((s) => (
                <li key={s.name} className="leading-snug">
                  <a href={s.href} target="_blank" rel="noreferrer" className="tap inline-flex items-center font-semibold text-ink underline-offset-4 hover:underline">
                    {s.name}
                  </a>
                  <span className="block text-xs text-ink-dim">{t(s.note)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* downloads + navigation */}
          <div>
            <h2 className="eyebrow">{t('data.download')}</h2>
            <p className="mt-4 text-sm text-ink-dim">{t('data.download_lead')}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                className="btn justify-between text-left"
                onClick={() => void downloadCsv({ kind: 'calendar', key: calendarKey(aoi.id, resolution), from: binStart(calRange.from, resolution), to: calRange.to }, `calendar_${slug}_${resolution}_${calRange.from}_${calRange.to}.csv`)}
              >
                <span className="min-w-0 truncate">{t('data.csv_calendar', { aoi: aoi.name })}</span>
                <span className="shrink-0 text-xs text-ink-dim">CSV ↓</span>
              </button>
              <button type="button" className="btn justify-between text-left" disabled={!count} onClick={() => void downloadCsv({ kind: 'hotspots' }, `hotspots_${slug}_${range.from}_${range.to}.csv`)}>
                <span className="min-w-0 truncate">{t('data.csv_hotspots')}</span>
                <span className="shrink-0 text-xs text-ink-dim">CSV ↓</span>
              </button>
              <p className="data text-xs text-ink-mute">
                {calRange.from} → {calRange.to} · {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
              </p>
              {USE_MOCKS && <p className="text-xs text-ink-mute">{t('data.mock_note')}</p>}
            </div>

            <h2 className="eyebrow mt-8">{t('nav.label')}</h2>
            <nav aria-label={t('footer.nav')} className="mt-3">
              <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {SECTIONS.filter((id) => id !== 'data').map((id) => (
                  <li key={id}>
                    <a href={`#${id}`} className="tap inline-flex items-center text-ink-dim transition-colors hover:text-ink">
                      <RollText>{t(`nav.${id}`)}</RollText>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs leading-relaxed text-ink-mute lg:flex-row lg:items-end lg:justify-between lg:gap-10">
          <p className="max-w-3xl">
            {t('data.ack')} {t('data.footer')}
          </p>
          <p className="shrink-0">
            © 2026 USTACODE · NASA Space Apps Challenge · “Harmonization of MODIS and VIIRS Hot Spots”
          </p>
        </div>
      </div>
    </footer>
  );
}
