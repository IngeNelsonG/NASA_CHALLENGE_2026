import type { Sensor } from './types';

/** One colour per instrument, used everywhere (globe, map, charts, satellites, legends). */
export const SENSOR_COLOR: Record<Sensor, string> = {
  modis: '#E08A55',
  viirs: '#6FA3D6',
  harmonized: '#CDAE52',
};

/** Every fire detection, whatever the sensor: the record is presented as one unified dataset. */
export const HOTSPOT_COLOR = '#E07A4A';

/** Neutral warm chart chrome (gridlines, axis labels, marker halo). */
export const CHART = {
  grid: 'rgba(239,233,224,0.10)',
  axis: '#9A9184',
  halo: '#0E0D0B',
} as const;

/** Muted severity palette matching tailwind `sev.*` tokens. */
export const SEV_COLOR = {
  critical: '#D06B5E',
  warning: '#CF9150',
  watch: '#BFAE62',
  normal: '#7E9F89',
} as const;

/** Observed zero (distinct from "no observation", which is hatched). */
export const ZERO_COLOR = '#161B2B';
export const NODATA_BG = '#0C111E';
export const NODATA_STROKE = 'rgba(160,175,205,0.28)';

// Sequential fire ramp for a dark surface: lightness rises monotonically with magnitude.
const STOPS: [number, number, number][] = [
  [40, 22, 46],
  [86, 22, 48],
  [150, 32, 36],
  [210, 76, 26],
  [242, 142, 32],
  [250, 198, 70],
  [255, 242, 176],
];

export function fireRGB(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const f = x - i;
  const a = STOPS[i], b = STOPS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export const FIRE_LUT: string[] = Array.from({ length: 64 }, (_, i) => {
  const [r, g, b] = fireRGB(i / 63);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
});

/** value → 0..1 on a square-root scale (fire counts are heavily right-skewed). */
export const fireT = (v: number, max: number) => Math.sqrt(Math.min(1, Math.max(0, v / (max || 1))));
export const fireColor = (v: number, max: number) =>
  v <= 0 ? ZERO_COLOR : FIRE_LUT[Math.min(63, Math.floor(fireT(v, max) * 63.999))];

export const fireGradientCss = `linear-gradient(90deg, ${[0, 0.17, 0.33, 0.5, 0.67, 0.83, 1]
  .map((t) => FIRE_LUT[Math.round(t * 63)])
  .join(',')})`;

let hatch: CanvasPattern | null = null;
/** Diagonal hatch used for "no observation" cells. */
export function noDataPattern(ctx: CanvasRenderingContext2D): CanvasPattern | string {
  if (hatch) return hatch;
  const c = document.createElement('canvas');
  c.width = c.height = 6;
  const g = c.getContext('2d');
  if (!g) return NODATA_BG;
  g.fillStyle = NODATA_BG;
  g.fillRect(0, 0, 6, 6);
  g.strokeStyle = NODATA_STROKE;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-1, 7);
  g.lineTo(7, -1);
  g.moveTo(-1, 1);
  g.lineTo(1, -1);
  g.moveTo(5, 7);
  g.lineTo(7, 5);
  g.stroke();
  hatch = ctx.createPattern(c, 'repeat');
  return hatch ?? NODATA_BG;
}
