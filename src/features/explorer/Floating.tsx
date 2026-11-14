import { useMemo } from 'react';
import { fmtInt, useT } from '@/app/i18n';
import { SensorDot } from '@/components/ui';
import { HOTSPOT_COLOR, SENSOR_COLOR } from '@/lib/colors';
import { bboxId, DEG, fmtLat, fmtLon } from '@/lib/geo';
import { satScenePos, sceneToGeodetic } from '@/lib/satellites';
import { simClock } from '@/lib/simClock';
import { view } from '@/scenes/view';
import { useStore } from '@/store';
import { useData } from '@/store/data';

/** Hover card for a satellite (3D globe and 2D map). */
export function SatCard() {
  const t = useT();
  const hover = useStore((s) => s.hoverSat);
  const sats = useData((s) => s.sats);
  const sat = hover && sats.find((s) => s.norad === hover.norad);
  if (!hover || !sat) return null;
  const p = [0, 0, 0];
  const pos = satScenePos(sat.rec, simClock.now(), p) ? sceneToGeodetic(p[0], p[1], p[2]) : null;
  const left = Math.min(window.innerWidth - 250, hover.x + 16);
  const top = Math.max(72, Math.min(window.innerHeight - 190, hover.y - 20));
  const sensor = sat.meta.instrument === 'MODIS' ? 'modis' : 'viirs';
  return (
    <div role="tooltip" className="panel pointer-events-none fixed z-50 w-[234px] p-3 text-xs" style={{ left, top, borderColor: SENSOR_COLOR[sensor] }}>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <SensorDot sensor={sensor} /> {sat.name}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-dim">
        <dt>{t('sat.instrument')}</dt>
        <dd className="data text-right text-ink">{sat.meta.instrument}</dd>
        <dt>{t('sat.resolution')}</dt>
        <dd className="data text-right text-ink">{sat.meta.resolution}</dd>
        <dt>{t('sat.overpass')}</dt>
        <dd className="data text-right text-ink">
          ≈ {sat.meta.overpass} {t(sat.meta.node === 'asc' ? 'sat.asc' : 'sat.desc')}
        </dd>
        <dt>{t('sat.data_since')}</dt>
        <dd className="data text-right text-ink">{sat.meta.since}–</dd>
        {pos && (
          <>
            <dt>{t('sat.position')}</dt>
            <dd className="data text-right text-ink">
              {pos.lat.toFixed(1)}°, {pos.lon.toFixed(1)}° · {Math.round(pos.altKm)} km
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

const RADIUS_KM = 25;

/** Panel for a clicked point: coordinates, nearby detections, and "use as AOI". Bottom sheet on mobile. */
export function PickPanel() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const picked = useStore((s) => s.picked);
  const hot = useData((s) => s.hotspots);

  const near = useMemo(() => {
    if (!picked || !hot) return null;
    const dLat = RADIUS_KM / 111.2, cl = Math.cos(picked.lat * DEG) || 1;
    let n = 0;
    for (let i = 0; i < hot.count; i++) {
      const dy = hot.lonlat[i * 2 + 1] - picked.lat;
      if (Math.abs(dy) > dLat) continue;
      const dx = (hot.lonlat[i * 2] - picked.lon) * cl;
      if (dx * dx + dy * dy <= dLat * dLat) n++;
    }
    return n;
  }, [picked, hot]);

  if (!picked) return null;
  const close = () => useStore.getState().set({ picked: null });
  const useAsAoi = () => {
    const r = (x: number) => Math.round(x * 100) / 100;
    const bbox: [number, number, number, number] = [r(picked.lon - 1), r(Math.max(-89, picked.lat - 1)), r(picked.lon + 1), r(Math.min(89, picked.lat + 1))];
    useStore.getState().setAoi({ id: bboxId(bbox), name: `${fmtLat(picked.lat)}, ${fmtLon(picked.lon)} ±1°`, bbox });
  };

  return (
    <aside
      aria-label={t('pick.title')}
      className="panel fade-in fixed inset-x-0 bottom-0 z-40 rounded-b-none p-4 pb-6 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-80 xl:left-24 sm:rounded-b-xl sm:pb-4"
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" aria-hidden />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{t('pick.title')}</p>
          <p className="data mt-1 text-lg text-ink">
            {fmtLat(picked.lat)} <span className="text-ink-mute">·</span> {fmtLon(picked.lon)}
          </p>
        </div>
        <button type="button" className="btn btn-icon" onClick={close} aria-label={t('pick.close')}>
          <span aria-hidden>✕</span>
        </button>
      </div>
      {near !== null && (
        <div className="mt-3 text-sm text-ink-dim">
          <p>{t('pick.nearby', { km: RADIUS_KM })}</p>
          <p className="data mt-1 flex items-center gap-4 text-base text-ink">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: HOTSPOT_COLOR }} /> {fmtInt(near, lang)} {t('time.hotspots')}
            </span>
          </p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" onClick={useAsAoi}>
          {t('pick.use_aoi')}
        </button>
        <button type="button" className="btn" onClick={() => view.flyTo(picked.lon, picked.lat, Math.max(view.zoom, 2.5))}>
          {t('pick.center')}
        </button>
      </div>
    </aside>
  );
}
