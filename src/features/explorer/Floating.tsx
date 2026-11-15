import { useT } from '@/app/i18n';
import { SensorDot } from '@/components/ui';
import { SENSOR_COLOR } from '@/lib/colors';
import { satScenePos, sceneToGeodetic } from '@/lib/satellites';
import { simClock } from '@/lib/simClock';
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
