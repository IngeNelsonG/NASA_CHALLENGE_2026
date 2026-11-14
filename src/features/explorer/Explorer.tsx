import { lazy, Suspense, useRef } from 'react';
import { useT } from '@/app/i18n';
import { Segmented, Spinner } from '@/components/ui';
import { AoiSearch } from '@/features/aoi/AoiSearch';
import { HOTSPOT_COLOR } from '@/lib/colors';
import { useGlobeStage } from '@/scenes/useGlobeStage';
import { view, type StageLayout } from '@/scenes/view';
import { useStore } from '@/store';
import { useData } from '@/store/data';
import { Map2D } from './Map2D';
import { SatelliteImage } from './SatelliteImage';
import { Timeline } from './Timeline';

const CalendarSection = lazy(() => import('@/features/calendar/CalendarSection'));

/** px reserved on the left for the panels (lg and up); the globe centres in what remains. */
const SIDE = 392;
const LG = 1024;
const besidePanels: StageLayout = (r) => {
  const side = r.width >= LG ? SIDE : 0;
  const w = r.width - side;
  const h = r.width >= LG ? r.height - 110 : r.height; // leave the timeline its strip
  return { cx: r.left + side + w / 2, cy: r.top + (r.width >= LG ? 40 + h / 2 : h / 2), r: 0.42 * Math.min(w, h) };
};

/** Why there may be no points for this area (only shown when it matters). */
function CoverageNote() {
  const t = useT();
  const coverage = useData((s) => s.coverage);
  if (!coverage || coverage.source === 'archive' || coverage.source === 'firms') return null;
  const key =
    coverage.source === 'too_long' ? 'coverage.too_long' : coverage.source === 'partial' ? 'coverage.partial' : 'coverage.none';
  return (
    <p role="note" className="mt-3 rounded-lg border border-harmonized/40 bg-harmonized/10 px-3 py-2 text-[12px] leading-relaxed text-ink">
      {t(key, { days: coverage.maxDays })}
    </p>
  );
}

export function Explorer() {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const viewMode = useStore((s) => s.viewMode);
  const webgl = useStore((s) => s.webgl);
  const tool = useStore((s) => s.tool);
  const aoi = useStore((s) => s.aoi);
  const set = useStore((s) => s.set);
  useGlobeStage(stage, 'explore', { interactive: viewMode === '3d', layout: besidePanels });

  return (
    <section id="explore" aria-labelledby="explore-title" className="frame -scroll-mt-[5.5rem]">
      <div className="window">
        {/* globe block */}
        <div className="relative lg:h-[100svh] lg:min-h-[780px]">
          <div
            ref={stage}
            tabIndex={viewMode === '3d' ? 0 : -1}
            role="application"
            aria-label={t('globe.aria')}
            aria-describedby="globe-help"
            className={`relative h-[60svh] min-h-[340px] touch-none select-none lg:absolute lg:inset-0 lg:h-auto ${tool === 'rect' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          >
            {viewMode === '2d' && <Map2D />}
          </div>
          <p id="globe-help" className="sr-only">
            {t('globe.help')}
          </p>

          {/* zoom: small, out of the way, over the globe */}
          <div className="absolute right-3 top-[4.75rem] z-10 flex flex-col gap-1.5 sm:right-5 lg:right-6 lg:top-24">
            <button type="button" className="btn btn-icon !min-h-[36px] !min-w-[36px]" onClick={() => view.zoomBy(1.4)} aria-label={t('globe.zoom_in')}>
              <span aria-hidden>+</span>
            </button>
            <button type="button" className="btn btn-icon !min-h-[36px] !min-w-[36px]" onClick={() => view.zoomBy(1 / 1.4)} aria-label={t('globe.zoom_out')}>
              <span aria-hidden>−</span>
            </button>
            <button type="button" className="btn btn-icon !min-h-[36px] !min-w-[36px]" onClick={() => useStore.getState().flyToAoi()} aria-label={t('globe.fit')} title={t('globe.fit')}>
              <span aria-hidden>⌖</span>
            </button>
          </div>

          <div className="pointer-events-none relative z-10 flex flex-col gap-3 px-3 pb-4 pt-3 sm:px-6 lg:absolute lg:inset-0 lg:grid lg:grid-cols-[22.5rem_1fr] lg:grid-rows-[1fr_auto] lg:gap-4 lg:px-6 lg:pb-6 lg:pt-24 xl:pl-24">
            {/* left column: area + satellite image */}
            <div className="flex min-h-0 flex-col gap-3 lg:col-start-1 lg:row-span-2 lg:overflow-y-auto lg:pb-1 lg:pr-1 [scrollbar-width:thin]">
              <div className="panel pointer-events-auto p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="eyebrow">{t('nav.explore')}</p>
                    <h2 id="explore-title" className="mt-1 text-2xl">
                      {t('aoi.title')}
                    </h2>
                  </div>
                  <Segmented
                    size="sm"
                    label={t('view.label')}
                    value={viewMode}
                    onChange={(v) => webgl && set({ viewMode: v })}
                    options={[
                      { value: '3d', label: t('view.3d'), title: webgl ? undefined : t('view.no_webgl') },
                      { value: '2d', label: t('view.2d') },
                    ]}
                  />
                </div>
                {!webgl && <p className="mt-2 text-xs text-ink-dim">{t('view.no_webgl')}</p>}
                <div className="mt-3">
                  <AoiSearch />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="min-w-0 text-sm">
                    <span className="block text-xs text-ink-dim">{t('aoi.current')}</span>
                    <span className="block truncate font-semibold text-ink" title={aoi.name}>
                      {aoi.name}
                    </span>
                  </p>
                  <button
                    type="button"
                    className={`btn shrink-0 !min-h-[36px] !text-xs ${tool === 'rect' ? 'btn-primary' : ''}`}
                    aria-pressed={tool === 'rect'}
                    onClick={() => set({ tool: tool === 'rect' ? 'pan' : 'rect' })}
                  >
                    <span aria-hidden>▭</span> {tool === 'rect' ? t('aoi.drawing') : t('aoi.draw')}
                  </button>
                </div>
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[11px] text-ink-dim">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: HOTSPOT_COLOR }} /> {t('legend.hotspot')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0.5 w-3 bg-brand-yellow" /> {t('legend.aoi')}
                  </span>
                </p>
                <CoverageNote />
              </div>
              <SatelliteImage />
            </div>

            <div className="flex items-end justify-center lg:col-start-2 lg:row-start-2">
              <div className="flex w-full max-w-3xl flex-col items-center gap-2">
                <Timeline />
                <a href="#calendar" className="pointer-events-auto hidden items-center gap-1.5 text-xs text-ink-dim hover:text-ink lg:inline-flex">
                  {t('explore.to_calendar')} <span aria-hidden className="bob">↓</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* the calendar continues the same surface: scroll a little and it is there */}
        <div aria-hidden className="mx-6 h-px bg-gradient-to-r from-transparent via-line to-transparent lg:mx-10" />
        <Suspense
          fallback={
            <div id="calendar" className="grid min-h-[60vh] place-items-center">
              <Spinner label={t('common.loading')} />
            </div>
          }
        >
          <CalendarSection />
        </Suspense>
      </div>
    </section>
  );
}
