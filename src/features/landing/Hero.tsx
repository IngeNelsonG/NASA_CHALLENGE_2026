import { useRef } from 'react';
import { useT } from '@/app/i18n';
import { AoiSearch } from '@/features/aoi/AoiSearch';
import { Map2D } from '@/features/explorer/Map2D';
import { isMobile } from '@/lib/capabilities';
import { useGlobeStage } from '@/scenes/useGlobeStage';
import { useStore } from '@/store';

const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function Hero() {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const viewMode = useStore((s) => s.viewMode);
  const aoi = useStore((s) => s.aoi);
  const mobile = isMobile();
  // On phones the globe is a dimmed, non-interactive backdrop so vertical swipes always scroll the page.
  useGlobeStage(stage, 'hero', { interactive: !mobile && viewMode === '3d', alpha: mobile ? 0.35 : 1 });

  return (
    <section id="hero" aria-labelledby="hero-title" className="relative mx-auto grid min-h-[100svh] w-full max-w-[1440px] items-center gap-6 px-4 pb-10 pt-24 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] xl:pl-24">
      <div className="relative z-10 max-w-xl">
        <p className="eyebrow">{t('hero.eyebrow')}</p>
        <h1 id="hero-title" className="mt-3 text-4xl font-extrabold leading-[1.05] sm:text-5xl xl:text-6xl">
          {t('hero.title')}
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-dim">{t('hero.lead')}</p>
        <div className="panel mt-7 p-4">
          <AoiSearch onSelect={() => goTo('explore')} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={() => (useStore.getState().flyToAoi(), goTo('explore'))}>
              {t('hero.explore')} <span aria-hidden>→</span>
            </button>
            <button type="button" className="btn" onClick={() => goTo('calendar')}>
              {t('hero.calendar_cta')}
            </button>
            <span className="text-xs text-ink-dim">
              {t('aoi.current')}: <span className="font-semibold text-ink">{aoi.name}</span>
            </span>
          </div>
        </div>
        <dl className="data mt-7 grid max-w-md grid-cols-3 gap-4 text-xs text-ink-dim">
          <div>
            <dt>MODIS · 1 km</dt>
            <dd className="mt-0.5 text-lg text-ink">2000 →</dd>
          </div>
          <div>
            <dt>VIIRS · 375 m</dt>
            <dd className="mt-0.5 text-lg text-ink">2012 →</dd>
          </div>
          <div>
            <dt>{t('hero.stat_platforms')}</dt>
            <dd className="mt-0.5 text-lg text-ink">5</dd>
          </div>
        </dl>
      </div>
      <div
        ref={stage}
        tabIndex={mobile || viewMode === '2d' ? -1 : 0}
        role={mobile ? undefined : 'application'}
        aria-label={mobile ? undefined : t('globe.aria')}
        aria-hidden={mobile || undefined}
        className={
          mobile
            ? 'pointer-events-none absolute inset-0 -z-0'
            : 'relative h-[min(78svh,820px)] min-h-[420px] cursor-grab touch-pan-y select-none active:cursor-grabbing'
        }
      >
        {viewMode === '2d' && <Map2D interactive={false} />}
      </div>
    </section>
  );
}
