import { useRef } from 'react';
import { useT } from '@/app/i18n';
import { Segmented, Toggle } from '@/components/ui';
import { AoiSearch } from '@/features/aoi/AoiSearch';
import { fireGradientCss } from '@/lib/colors';
import { useGlobeStage } from '@/scenes/useGlobeStage';
import { view } from '@/scenes/view';
import { useStore, type LayerId, type TimeScale } from '@/store';
import { Map2D } from './Map2D';
import { Timeline } from './Timeline';

const LAYERS: LayerId[] = ['density', 'terminator', 'orbits', 'borders'];

export function Explorer() {
  const t = useT();
  const stage = useRef<HTMLDivElement>(null);
  const viewMode = useStore((s) => s.viewMode);
  const webgl = useStore((s) => s.webgl);
  const tool = useStore((s) => s.tool);
  const aoi = useStore((s) => s.aoi);
  const layers = useStore((s) => s.layers);
  const timeScale = useStore((s) => s.timeScale);
  const set = useStore((s) => s.set);
  const toggleLayer = useStore((s) => s.toggleLayer);
  useGlobeStage(stage, 'explore', { interactive: viewMode === '3d' });

  return (
    <section id="explore" aria-labelledby="explore-title" className="relative scroll-mt-0 lg:h-[100svh] lg:min-h-[760px]">
      <div
        ref={stage}
        tabIndex={viewMode === '3d' ? 0 : -1}
        role="application"
        aria-label={t('globe.aria')}
        aria-describedby="globe-help"
        className={`relative h-[62svh] touch-none select-none lg:absolute lg:inset-0 lg:h-auto ${tool === 'rect' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      >
        {viewMode === '2d' && <Map2D />}
      </div>
      <p id="globe-help" className="sr-only">
        {t('globe.help')}
      </p>

      <div className="pointer-events-none relative z-10 flex flex-col gap-3 px-4 pb-10 sm:px-6 lg:absolute lg:inset-0 lg:grid lg:grid-cols-[20rem_1fr_17rem] lg:grid-rows-[1fr_auto] lg:pb-6 lg:pt-20 xl:pl-24">
        {/* AOI */}
        <div className="panel pointer-events-auto self-start p-4 lg:col-start-1 lg:row-start-1">
          <p className="eyebrow">{t('nav.explore')}</p>
          <h2 id="explore-title" className="mt-1 text-xl font-extrabold">
            {t('aoi.title')}
          </h2>
          <div className="mt-3">
            <AoiSearch />
          </div>
          <dl className="mt-3 text-sm">
            <dt className="text-xs text-ink-dim">{t('aoi.current')}</dt>
            <dd className="font-semibold text-ink">{aoi.name}</dd>
            <dd className="data mt-0.5 text-[11px] text-ink-dim">
              W {aoi.bbox[0].toFixed(2)} · S {aoi.bbox[1].toFixed(2)} · E {aoi.bbox[2].toFixed(2)} · N {aoi.bbox[3].toFixed(2)}
            </dd>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={`btn ${tool === 'rect' ? 'btn-primary' : ''}`} aria-pressed={tool === 'rect'} onClick={() => set({ tool: tool === 'rect' ? 'pan' : 'rect' })}>
              <span aria-hidden>▭</span> {tool === 'rect' ? t('aoi.drawing') : t('aoi.draw')}
            </button>
            <button type="button" className="btn" onClick={() => useStore.getState().flyToAoi()}>
              <span aria-hidden>⌖</span> {t('globe.fit')}
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-dim">{t('aoi.or_click')}</p>
        </div>

        {/* Layers + legend */}
        <div className="panel pointer-events-auto self-start p-4 lg:col-start-3 lg:row-start-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('layers.title')}</h3>
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
          <div className="mt-2 grid grid-cols-2 gap-x-3 lg:grid-cols-1">
            {LAYERS.map((id) => (
              <Toggle key={id} checked={layers[id]} onChange={() => toggleLayer(id)}>
                {t(`layers.${id}`)}
              </Toggle>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-3 text-xs text-ink-dim">
            <p className="mb-1.5 font-semibold text-ink">{t('legend.title')}</p>
            <p className="mb-2 leading-snug">{t('legend.both')}</p>
            <p className="flex items-center gap-2">
              <span aria-hidden className="inline-block h-3 w-3 rounded-full bg-modis" /> {t('legend.modis')}
            </p>
            <p className="mt-1 flex items-center gap-2">
              <span aria-hidden className="ml-[2px] mr-[2px] inline-block h-2 w-2 rounded-full bg-viirs" /> {t('legend.viirs')}
            </p>
            <p className="mt-1 flex items-center gap-2">
              <span aria-hidden className="inline-block h-0.5 w-3 bg-brand-yellow" /> {t('legend.aoi')}
            </p>
            {layers.density && (
              <div className="mt-2">
                <p>{t('legend.density')}</p>
                <div aria-hidden className="mt-1 h-2 rounded" style={{ background: fireGradientCss }} />
                <p className="data mt-0.5 flex justify-between text-[10px]">
                  <span>{t('legend.low')}</span>
                  <span>{t('legend.high')}</span>
                </p>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
            <span className="text-xs text-ink-dim">{t('sat.speed')}</span>
            <Segmented
              size="sm"
              label={t('sat.speed')}
              value={String(timeScale)}
              onChange={(v) => set({ timeScale: +v as TimeScale })}
              options={[
                { value: '1', label: '×1' },
                { value: '60', label: '×60' },
                { value: '600', label: '×600' },
              ]}
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" className="btn btn-icon" onClick={() => view.zoomBy(1.4)} aria-label={t('globe.zoom_in')}>
              <span aria-hidden>+</span>
            </button>
            <button type="button" className="btn btn-icon" onClick={() => view.zoomBy(1 / 1.4)} aria-label={t('globe.zoom_out')}>
              <span aria-hidden>−</span>
            </button>
            <span className="text-[11px] leading-tight text-ink-mute">{t('globe.hint_zoom')}</span>
          </div>
        </div>

        <div className="flex justify-center lg:col-span-3 lg:row-start-2">
          <Timeline />
        </div>
      </div>
    </section>
  );
}
