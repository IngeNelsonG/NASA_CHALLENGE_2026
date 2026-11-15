import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useT } from '@/app/i18n';
import { Spinner } from '@/components/ui';
import { AoiSearch } from '@/features/aoi/AoiSearch';
import { HOTSPOT_COLOR } from '@/lib/colors';
import { useGlobeStage } from '@/scenes/useGlobeStage';
import { view, type StageLayout } from '@/scenes/view';
import { isWorld, useAoiName, useStore } from '@/store';
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
  return { cx: r.left + side + w / 2, cy: r.top + (r.width >= LG ? 12 + h / 2 : h / 2), r: 0.42 * Math.min(w, h) };
};

/** Why there may be no points for this area (only shown when it matters). */
function CoverageNote() {
  const t = useT();
  const coverage = useData((s) => s.coverage);
  if (!coverage || coverage.source === 'archive' || coverage.source === 'firms') return null;
  const key =
    coverage.source === 'too_long' ? 'coverage.too_long' : coverage.source === 'partial' ? 'coverage.partial' : 'coverage.none';
  return (
    <p role="note" className="mt-3 rounded-lg bg-harmonized/10 px-3 py-2 text-xs leading-relaxed text-ink">
      {t(key, { days: coverage.maxDays })}
    </p>
  );
}

const isOnScreen = (id: string) => {
  const r = document.getElementById(id)?.getBoundingClientRect();
  return !!r && r.bottom > 0 && r.top < window.innerHeight;
};

/**
 * Esc cancels: first a rectangle being drawn, then the selected area (back to the default one).
 * Only while the globe or the calendar is on screen, and never while typing or in a dialog.
 */
function useEscapeToClear() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (document.getElementById('mobile-menu')) return;
      if (!isOnScreen('explore') && !isOnScreen('calendar')) return;
      const s = useStore.getState();
      if (s.tool === 'rect') {
        view.draft = null;
        s.set({ tool: 'pan' });
        view.kick();
      } else s.clearAoi();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function Explorer() {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const mobileSearchRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const viewMode = useStore((s) => s.viewMode);
  const webgl = useStore((s) => s.webgl);
  const tool = useStore((s) => s.tool);
  const aoi = useStore((s) => s.aoi);
  const aoiName = useAoiName();
  const prevAoi = useStore((s) => s.aoiHistory[s.aoiHistory.length - 1]);
  const undoAoi = useStore((s) => s.undoAoi);
  const clearAoi = useStore((s) => s.clearAoi);
  const set = useStore((s) => s.set);
  const selected = !isWorld(aoi);
  useGlobeStage(stage, 'explore', { interactive: viewMode === '3d', layout: besidePanels });
  useEscapeToClear();

  useEffect(() => {
    if (!searchOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSearchOpen(false);
    const onDown = (e: PointerEvent) => !mobileSearchRef.current?.contains(e.target as Node) && setSearchOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [searchOpen]);

  return (
    <section id="explore" aria-labelledby="explore-title" className="frame">
      <div className="window">
        <div className="relative lg:h-[100svh] lg:min-h-[780px]">
          <div
            ref={stage}
            tabIndex={viewMode === '3d' ? 0 : -1}
            role="application"
            aria-label={t('globe.aria')}
            aria-describedby="globe-help"
            className={`relative h-[60svh] min-h-[340px] touch-pan-y select-none lg:absolute lg:inset-0 lg:h-auto ${tool === 'rect' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          >
            {/* the 2D map is only the fallback for devices without WebGL */}
            {viewMode === '2d' && <Map2D />}
          </div>
          <p id="globe-help" className="sr-only">
            {t('globe.help')}
          </p>

          {/* mobile: stacked magnifying glass search over the top-left of the globe so the satellite image sits right below */}
          <div ref={mobileSearchRef} className="absolute left-3 right-16 top-3 z-20 flex items-center gap-2 sm:left-5 lg:hidden">
            <button
              type="button"
              className="btn btn-icon shrink-0 rounded-full !bg-graphite-900/90 shadow-panel backdrop-blur-md"
              aria-expanded={searchOpen}
              aria-controls="mobile-aoi-panel"
              aria-label={t('aoi.search_label')}
              title={t('aoi.search_label')}
              onClick={() => setSearchOpen((v) => !v)}
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>
            {selected && (
              <div className="panel flex min-w-0 items-center gap-1.5 rounded-full !bg-graphite-900/90 py-1 pl-3 pr-1.5 text-xs backdrop-blur-md">
                <span className="truncate font-semibold text-ink" title={aoiName}>
                  {aoiName}
                </span>
                <button
                  type="button"
                  className="tap inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-dim hover:bg-graphite-700 hover:text-ink"
                  onClick={clearAoi}
                  aria-label={t('aoi.clear')}
                  title={t('aoi.clear_hint')}
                >
                  <span aria-hidden>✕</span>
                </button>
              </div>
            )}

            {searchOpen && (
              <div
                id="mobile-aoi-panel"
                role="dialog"
                aria-label={t('aoi.title')}
                className="panel assistant-in absolute left-0 top-full mt-2 w-[min(22rem,calc(100vw-1.5rem))] !bg-graphite-800 p-3.5 shadow-panel"
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="eyebrow">{t('nav.explore')}</p>
                    <p className="mt-0.5 text-base font-semibold text-ink">{t('aoi.title')}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-icon btn-sm"
                    onClick={() => setSearchOpen(false)}
                    aria-label={t('header.menu_close')}
                  >
                    <span aria-hidden>✕</span>
                  </button>
                </div>
                {!webgl && <p className="mt-2 text-xs text-ink-dim">{t('view.no_webgl')}</p>}
                <div className="mt-2.5">
                  <AoiSearch onSelect={() => setSearchOpen(false)} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-mute">{t('aoi.or_click')}</p>
                <div className="mt-3 rounded-xl border border-line bg-graphite-900/60 p-2.5">
                  <p className="min-w-0 text-xs">
                    <span className="block text-ink-dim">{t('aoi.current')}</span>
                    <span className="block truncate font-semibold text-ink" title={aoiName}>
                      {selected ? aoiName : t('aoi.no_selection')}
                    </span>
                  </p>
                  {!selected && <p className="mt-1 text-xs leading-relaxed text-ink-dim">{t('aoi.world_note')}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`btn btn-sm ${tool === 'rect' ? 'btn-primary' : ''}`}
                      aria-pressed={tool === 'rect'}
                      onClick={() => {
                        set({ tool: tool === 'rect' ? 'pan' : 'rect' });
                        setSearchOpen(false);
                      }}
                    >
                      <span aria-hidden>▭</span> {tool === 'rect' ? t('aoi.drawing') : t('aoi.draw')}
                    </button>
                    {selected && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          clearAoi();
                          setSearchOpen(false);
                        }}
                        title={t('aoi.clear_hint')}
                      >
                        <span aria-hidden>✕</span> {t('aoi.clear')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* zoom: over the globe; on phones at its lower corner, inside the thumb's easy reach */}
          <div className="absolute right-3 top-[calc(max(60svh,340px)-0.75rem)] z-10 flex -translate-y-full flex-col gap-2 sm:right-5 lg:right-6 lg:top-6 lg:translate-y-0">
            <button type="button" className="btn btn-icon" onClick={() => view.zoomBy(1.4)} aria-label={t('globe.zoom_in')}>
              <span aria-hidden>+</span>
            </button>
            <button type="button" className="btn btn-icon" onClick={() => view.zoomBy(1 / 1.4)} aria-label={t('globe.zoom_out')}>
              <span aria-hidden>−</span>
            </button>
            <button type="button" className="btn btn-icon" onClick={() => useStore.getState().flyToAoi()} aria-label={t('globe.fit')} title={t('globe.fit')}>
              <span aria-hidden>⌖</span>
            </button>
            {prevAoi && (
              <button
                type="button"
                className="btn btn-icon"
                onClick={undoAoi}
                aria-label={`${t('aoi.undo')}: ${t('aoi.undo_to', { name: prevAoi.name })}`}
                title={`${t('aoi.undo')} · ${t('aoi.undo_to', { name: prevAoi.name })}`}
              >
                <span aria-hidden>↶</span>
              </button>
            )}
          </div>

          <div className={`pointer-events-none relative z-10 flex flex-col gap-3 px-3 sm:px-6 lg:absolute lg:inset-0 lg:grid lg:grid-cols-[22.5rem_1fr] lg:grid-rows-[1fr_auto] lg:gap-4 lg:px-6 lg:pb-6 lg:pt-6 xl:pl-24 ${selected ? 'pb-4 pt-3' : 'pb-0 pt-0'}`}>
            {/* left column: area (desktop) + satellite image */}
            <div className="flex min-h-0 flex-col gap-3 lg:col-start-1 lg:row-span-2 lg:overflow-y-auto lg:pb-1 lg:pr-1 [scrollbar-width:thin]">
              <div className="panel pointer-events-auto hidden p-4 lg:block">
                <p className="eyebrow">{t('nav.explore')}</p>
                <h2 id="explore-title" className="mt-1 text-2xl">
                  {t('aoi.title')}
                </h2>
                {!webgl && <p className="mt-2 text-xs text-ink-dim">{t('view.no_webgl')}</p>}
                <div className="mt-3">
                  <AoiSearch />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-mute">{t('aoi.or_click')}</p>

                <div className="mt-3 rounded-xl border border-line bg-graphite-900/60 p-3">
                  <p className="min-w-0 text-sm">
                    <span className="block text-xs text-ink-dim">{t('aoi.current')}</span>
                    <span className="block truncate font-semibold text-ink" title={aoiName}>
                      {selected ? aoiName : t('aoi.no_selection')}
                    </span>
                  </p>
                  {!selected && <p className="mt-1.5 text-xs leading-relaxed text-ink-dim">{t('aoi.world_note')}</p>}
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`btn btn-sm ${tool === 'rect' ? 'btn-primary' : ''}`}
                      aria-pressed={tool === 'rect'}
                      onClick={() => set({ tool: tool === 'rect' ? 'pan' : 'rect' })}
                    >
                      <span aria-hidden>▭</span> {tool === 'rect' ? t('aoi.drawing') : t('aoi.draw')}
                    </button>
                    {selected && (
                      <button type="button" className="btn btn-sm" onClick={clearAoi} title={t('aoi.clear_hint')}>
                        <span aria-hidden>✕</span> {t('aoi.clear')}
                        <kbd className="data ml-0.5 hidden rounded border border-line px-1 text-[0.75rem] leading-4 text-ink-mute sm:inline">Esc</kbd>
                      </button>
                    )}
                  </div>
                </div>

                {selected && (
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-dim">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: HOTSPOT_COLOR }} /> {t('legend.hotspot')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="inline-block h-0.5 w-3 bg-harmonized" /> {t('legend.aoi')}
                  </span>
                </p>
                )}
                <CoverageNote />
              </div>
              {selected && <SatelliteImage />}
            </div>

            <div className="flex items-end justify-center lg:col-start-2 lg:row-start-2">
              <div className="flex w-full max-w-3xl flex-col items-center gap-2">
                {selected && <Timeline />}
                <a href="#calendar" className="pointer-events-auto hidden items-center gap-1.5 text-xs text-ink-dim hover:text-ink lg:inline-flex">
                  {t('explore.to_calendar')} <span aria-hidden className="bob">↓</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** The burn calendar: its own dark window right after the explorer. */
export function CalendarBlock() {
  const t = useT();
  return (
    <section id="calendar" aria-labelledby="calendar-title" className="frame pt-6 sm:pt-8 lg:pt-10">
      <div className="window">
        <Suspense
          fallback={
            <div className="grid min-h-[60vh] place-items-center">
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
