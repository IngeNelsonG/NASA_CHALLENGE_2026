import { useRef } from 'react';
import { useT } from '@/app/i18n';
import { RollText, Sparkle } from '@/components/ui';
import { AoiSearch } from '@/features/aoi/AoiSearch';
import { Map2D } from '@/features/explorer/Map2D';
import { isMobile } from '@/lib/capabilities';
import { APP_NAME } from '@/lib/env';
import { useGlobeStage } from '@/scenes/useGlobeStage';
import type { StageLayout } from '@/scenes/view';
import { useStore } from '@/store';

const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** The Earth rises from the bottom of the window like a horizon, leaving the sky free for the title. */
const horizon: StageLayout = (rect) => {
  const size = Math.max(rect.width * 1.18, rect.height * 1.25);
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height * 0.66 + size / 2, r: size * 0.43 };
};

const WORDMARK = APP_NAME.split(' ')[0].toUpperCase();

export function Hero() {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const viewMode = useStore((s) => s.viewMode);
  const aoi = useStore((s) => s.aoi);
  const mobile = isMobile();
  // On phones the globe is not interactive here, so vertical swipes always scroll the page.
  useGlobeStage(stage, 'hero', { interactive: !mobile && viewMode === '3d', layout: horizon });

  return (
    <section id="hero" aria-labelledby="hero-title" className="frame">
      <div className="window flex min-h-[calc(100svh-1rem)] flex-col items-center overflow-hidden px-4 pb-6 pt-24 text-center sm:min-h-[calc(100svh-1.5rem)] sm:px-6 lg:min-h-[calc(100svh-2rem)] lg:pt-28">
        <div
          ref={stage}
          tabIndex={mobile || viewMode === '2d' ? -1 : 0}
          role={mobile ? undefined : 'application'}
          aria-label={mobile ? undefined : t('globe.aria')}
          aria-hidden={mobile || undefined}
          className={`absolute inset-0 select-none ${mobile ? 'pointer-events-none' : 'cursor-grab touch-pan-y active:cursor-grabbing'}`}
        >
          {viewMode === '2d' && <Map2D interactive={false} />}
        </div>

        <div className="pointer-events-none relative z-10 flex w-full max-w-3xl flex-col items-center">
          <Sparkle className="h-7 w-7 text-cream sm:h-9 sm:w-9" />
          <p aria-hidden className="wordmark mt-2 font-display text-[clamp(4.5rem,19vw,15rem)] font-light leading-[0.95] tracking-[0.01em] text-cream">
            {[...WORDMARK].map((ch, i) => (
              <span key={i} style={{ animationDelay: `${120 + i * 85}ms` }}>
                {ch}
              </span>
            ))}
          </p>
          <h1 id="hero-title" className="fade-in mt-3 max-w-2xl text-2xl leading-tight text-cream sm:text-3xl" style={{ animationDelay: '0.65s' }}>
            {t('hero.title')}
          </h1>
          <p className="fade-in mt-4 max-w-xl text-[15px] leading-relaxed text-ink-dim sm:text-base" style={{ animationDelay: '0.8s' }}>
            {t('hero.lead')}
          </p>

          <div className="fade-in pointer-events-auto mt-6 w-full max-w-xl" style={{ animationDelay: '0.95s' }}>
            <div className="panel flex flex-col gap-2 p-2 text-left sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <AoiSearch compact onSelect={() => goTo('explore')} />
              </div>
              <button type="button" className="btn btn-primary shrink-0 !px-5" onClick={() => (useStore.getState().flyToAoi(), goTo('explore'))}>
                <RollText>{t('hero.explore')}</RollText>
                <span aria-hidden className="btn-plus">+</span>
              </button>
            </div>
            <p className="mt-2.5 text-xs text-ink-dim">
              {t('aoi.current')}: <span className="font-semibold text-ink">{aoi.name}</span>
              <span aria-hidden> · </span>
              <button type="button" className="underline underline-offset-4 hover:text-ink" onClick={() => goTo('calendar')}>
                {t('hero.calendar_cta')}
              </button>
            </p>
          </div>
        </div>

        <div className="pointer-events-none relative z-10 mt-auto flex w-full items-end justify-between gap-4 pt-10">
          <p className="data hidden text-left text-[11px] leading-relaxed text-cream/80 md:block">
            MODIS · 1 km
            <br />
            2000 →
          </p>
          <a href="#statement" className="pointer-events-auto mx-auto flex flex-col items-center gap-1 py-1 text-sm text-cream">
            <RollText>{t('hero.discover')}</RollText>
            <span aria-hidden className="bob">↓</span>
          </a>
          <p className="data hidden text-right text-[11px] leading-relaxed text-cream/80 md:block">
            VIIRS · 375 m
            <br />
            2012 →
          </p>
        </div>
      </div>
    </section>
  );
}
