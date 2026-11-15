import { useState } from 'react';
import { fmtDay, useT } from '@/app/i18n';
import { Segmented } from '@/components/ui';
import { gibsImage, IMAGE_VIEWS, imageSensor, SENSOR_LABEL, worldviewUrl, type ImageSensor, type ImageView } from '@/lib/gibs';
import { dayIdx, isoDay, todayIso } from '@/lib/geo';
import { mainBox } from '@/lib/shape';
import { timelineRange, useStore } from '@/store';
import { useData } from '@/store/data';

/**
 * How the selected area looked from space on the timeline's day (or the busiest day of the period):
 * NASA GIBS true colour, burned-land false colour or thermal, with NASA's own fire detections on top.
 * This works for any place on Earth, also where our API has no point detections.
 */
export function SatelliteImage() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const aoi = useStore((s) => s.aoi);
  const date = useStore((s) => s.date);
  const granularity = useStore((s) => s.granularity);
  const peakDay = useData((s) => s.hotspots?.peakDay ?? null);
  const shape = useData((s) => (s.shapeFor === aoi.id ? s.shape : null));
  const [view, setView] = useState<ImageView>('true-color');
  // Load state belongs to one URL: a cached image can fire `load` before an effect could reset a
  // shared flag, which left the picture hidden, so the state is keyed by URL instead of reset.
  const [loaded, setLoaded] = useState<{ url: string; ok: boolean } | null>(null);
  // if the preferred satellite has no picture that day, fall back to MODIS once (keyed the same way)
  const [fallbackFor, setFallbackFor] = useState('');

  const range = timelineRange(date, granularity);
  // imagery for "today" is often not processed yet: never ask past yesterday
  const yesterday = isoDay(dayIdx(todayIso()) - 1);
  const mid = isoDay(Math.floor((dayIdx(range.from) + dayIdx(range.to)) / 2));
  let day = granularity === 'day' ? date : peakDay && peakDay >= range.from && peakDay <= range.to ? peakDay : mid;
  if (day > yesterday) day = yesterday;
  const isPeak = granularity !== 'day' && day === peakDay;

  const bbox = shape ? mainBox(shape) : aoi.bbox;
  const pictureKey = `${day}|${view}|${bbox.join(',')}`;
  const sensor: ImageSensor = fallbackFor === pictureKey ? 'MODIS' : imageSensor(day);
  const img = gibsImage(bbox, day, view, sensor);
  const state = loaded?.url !== img.url ? 'loading' : loaded.ok ? 'ok' : 'error';

  return (
    <section aria-labelledby="sat-title" className="panel pointer-events-auto overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <h3 id="sat-title" className="card-title">
          {t('satimg.title')}
        </h3>
        <Segmented<ImageView>
          size="sm"
          label={t('satimg.view')}
          value={view}
          onChange={setView}
          options={IMAGE_VIEWS.map((v) => ({ value: v, label: t(`satimg.${v}`) }))}
        />
      </div>
      <div className="relative bg-graphite-950" style={{ aspectRatio: `${img.width} / ${img.height}` }}>
        {state !== 'ok' && (
          <div className={`absolute inset-0 grid place-items-center text-xs text-ink-dim ${state === 'loading' ? 'animate-pulse bg-graphite-800/60' : ''}`} role="status">
            {state === 'loading' ? t('satimg.loading') : t('satimg.failed')}
          </div>
        )}
        <img
          key={img.url}
          src={img.url}
          width={img.width}
          height={img.height}
          alt={t(`satimg.alt_${view}`, { place: aoi.name, day: fmtDay(day, lang) })}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded({ url: img.url, ok: true })}
          onError={() => (sensor !== 'MODIS' ? setFallbackFor(pictureKey) : setLoaded({ url: img.url, ok: false }))}
          className={`block h-full w-full object-cover transition-opacity duration-700 ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
        />
      </div>
      <div className="px-4 pb-3.5 pt-2.5 text-xs leading-relaxed text-ink-dim">
        <p>
          {t('satimg.caption', { sensor: SENSOR_LABEL[sensor], day: fmtDay(day, lang) })}{' '}
          {isPeak && t('satimg.peak')}
        </p>
        <p className="mt-1 text-ink-mute">{t(`satimg.note_${view}`)}</p>
        <a href={worldviewUrl(bbox, day, view, sensor)} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 font-semibold text-ink underline-offset-4 hover:underline">
          {t('satimg.worldview')} <span aria-hidden>↗</span>
          <span className="sr-only">{t('satimg.new_tab')}</span>
        </a>
      </div>
    </section>
  );
}
