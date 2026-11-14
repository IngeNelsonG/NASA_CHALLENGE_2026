import { feature } from 'topojson-client';
import type { GeometryCollection } from 'topojson-specification';
import type { BBox } from './types';
import { loadWorld } from './world';

/** Rings of a (Multi)Polygon as flat [lon, lat, lon, lat, …] arrays, outer and holes alike. */
export type Shape = { rings: Float64Array[]; bbox: BBox };

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Backend (Natural Earth admin-1) country names → world-atlas (Natural Earth admin-0, 1:50m) names.
const ALIASES: Record<string, string> = {
  'united states': 'united states of america',
  usa: 'united states of america',
  'democratic republic of the congo': 'dem rep congo',
  'republic of the congo': 'congo',
  'central african republic': 'central african rep',
  'south sudan': 's sudan',
  'dominican republic': 'dominican rep',
  'bosnia and herzegovina': 'bosnia and herz',
  'equatorial guinea': 'eq guinea',
  'ivory coast': 'cote d ivoire',
  swaziland: 'eswatini',
  'solomon islands': 'solomon is',
  'western sahara': 'w sahara',
  'east timor': 'timor leste',
  'united republic of tanzania': 'tanzania',
  'republic of serbia': 'serbia',
  'czech republic': 'czechia',
  macedonia: 'north macedonia',
  'the bahamas': 'bahamas',
  'falkland islands': 'falkland is',
};

let countries: Promise<Map<string, GeoJSON.Geometry>> | null = null;
function countryIndex() {
  countries ??= loadWorld().then((w) => {
    const fc = feature(w, w.objects.countries as GeometryCollection) as GeoJSON.FeatureCollection;
    const m = new Map<string, GeoJSON.Geometry>();
    for (const f of fc.features) {
      const name = (f.properties as { name?: string } | null)?.name;
      if (name && f.geometry) m.set(norm(name), f.geometry);
    }
    return m;
  });
  return countries;
}

/** Country outline from the Natural Earth layer the globe already uses (null if not found). */
export async function countryGeometry(name: string): Promise<GeoJSON.Geometry | null> {
  const idx = await countryIndex();
  const n = norm(name.replace(/,.*$/, ''));
  return idx.get(ALIASES[n] ?? n) ?? idx.get(n) ?? null;
}

export function toShape(geometry: GeoJSON.Geometry | null | undefined): Shape | null {
  if (!geometry) return null;
  const polys =
    geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  const rings: Float64Array[] = [];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      const flat = new Float64Array(ring.length * 2);
      ring.forEach(([lon, lat], i) => {
        flat[i * 2] = lon;
        flat[i * 2 + 1] = lat;
        if (lon < w) w = lon;
        if (lon > e) e = lon;
        if (lat < s) s = lat;
        if (lat > n) n = lat;
      });
      if (ring.length >= 3) rings.push(flat);
    }
  }
  return rings.length ? { rings, bbox: [w, s, e, n] } : null;
}

/** Even-odd point-in-polygon over every ring, so holes and islands both work. */
export function inShape(shape: Shape, lon: number, lat: number): boolean {
  const [w, s, e, n] = shape.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return false;
  let inside = false;
  for (const r of shape.rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Plain-array rings for structured cloning into the worker. */
export const ringsOf = (shape: Shape | null) => (shape ? shape.rings.map((r) => Array.from(r)) : null);

/** Inverse of `ringsOf` (inside the worker). */
export function shapeFromRings(rings: number[][]): Shape | null {
  const out = rings.filter((r) => r.length >= 6).map((r) => Float64Array.from(r));
  if (!out.length) return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of out)
    for (let i = 0; i < r.length; i += 2) {
      w = Math.min(w, r[i]);
      e = Math.max(e, r[i]);
      s = Math.min(s, r[i + 1]);
      n = Math.max(n, r[i + 1]);
    }
  return { rings: out, bbox: [w, s, e, n] };
}
