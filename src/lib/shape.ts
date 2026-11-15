import { feature } from 'topojson-client';
import type { GeometryCollection } from 'topojson-specification';
import type { BBox } from './types';
import { loadWorld } from './world';

const BANDS = 256;

type BandIndex = {
  /** Flat [xi, yi, xj, yj, ...] for all non-horizontal edges. */
  edges: Float64Array;
  /** CSR offsets per latitude band (length BANDS + 1). */
  bandOffsets: Uint32Array;
  /** Edge offsets (index * 4 into `edges`) grouped by band. */
  bandEdges: Uint32Array;
};

/** Rings of a (Multi)Polygon as flat [lon, lat, lon, lat, …] arrays, outer and holes alike. */
export type Shape = { rings: Float64Array[]; bbox: BBox; index?: BandIndex };

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
  'russian federation': 'russia',
  'republic of korea': 'south korea',
  'dem rep korea': 'north korea',
  'lao pdr': 'laos',
  'brunei darussalam': 'brunei',
  'cape verde': 'cabo verde',
  'macedonia former yugoslav republic of': 'macedonia',
  'the gambia': 'gambia',
  'republic of congo': 'congo',
  'federated states of micronesia': 'micronesia',
  'faeroe islands': 'faeroe is',
  'aland islands': 'aland',
  'cook islands': 'cook is',
  'cayman islands': 'cayman is',
  'british virgin islands': 'british virgin is',
  'united states virgin islands': 'u s virgin is',
  'northern mariana islands': 'n mariana is',
  'turks and caicos islands': 'turks and caicos is',
  'wallis and futuna islands': 'wallis and futuna is',
  'heard i and mcdonald islands': 'heard i and mcdonald is',
  'french southern and antarctic lands': 'fr s antarctic lands',
  'french polynesia': 'fr polynesia',
  'saint pierre and miquelon': 'st pierre and miquelon',
  'saint barthelemy': 'st barthelemy',
  'saint martin': 'st martin',
  'saint kitts and nevis': 'st kitts and nevis',
  'saint vincent and the grenadines': 'st vin and gren',
  'antigua and barbuda': 'antigua and barb',
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

function buildBandIndex(rings: Float64Array[], bbox: BBox): BandIndex {
  const s = bbox[1], n = bbox[3], span = n - s;
  const raw: number[] = [];
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const yi = r[i + 1], yj = r[j + 1];
      if (yi === yj) continue;
      raw.push(r[i], yi, r[j], yj);
    }
  }
  const edges = Float64Array.from(raw);
  const bandOffsets = new Uint32Array(BANDS + 1);
  if (span <= 0 || edges.length === 0) {
    return { edges, bandOffsets, bandEdges: new Uint32Array(0) };
  }
  const edgeCount = edges.length >> 2;
  const b0s = new Uint16Array(edgeCount);
  const b1s = new Uint16Array(edgeCount);
  for (let e = 0; e < edgeCount; e++) {
    const o = e << 2;
    const yi = edges[o + 1], yj = edges[o + 3];
    const yMin = yi < yj ? yi : yj;
    const yMax = yi < yj ? yj : yi;
    const b0 = Math.min(BANDS - 1, Math.max(0, Math.floor(((yMin - s) / span) * BANDS)));
    const b1 = Math.min(BANDS - 1, Math.max(0, Math.floor(((yMax - s) / span) * BANDS)));
    b0s[e] = b0;
    b1s[e] = b1;
    for (let b = b0; b <= b1; b++) bandOffsets[b + 1]++;
  }
  for (let b = 1; b <= BANDS; b++) bandOffsets[b] += bandOffsets[b - 1];
  const cursor = bandOffsets.slice();
  const bandEdges = new Uint32Array(bandOffsets[BANDS]);
  for (let e = 0; e < edgeCount; e++) {
    const o = e << 2;
    for (let b = b0s[e]; b <= b1s[e]; b++) bandEdges[cursor[b]++] = o;
  }
  return { edges, bandOffsets, bandEdges };
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
  if (!rings.length) return null;
  const bbox: BBox = [w, s, e, n];
  return { rings, bbox, index: buildBandIndex(rings, bbox) };
}

/** Even-odd point-in-polygon over every ring, using the y-banded edge index. */
export function inShape(shape: Shape, lon: number, lat: number): boolean {
  const [w, s, e, n] = shape.bbox;
  if (lon < w || lon > e || lat < s || lat > n) return false;
  const span = n - s;
  if (span <= 0) return false;
  const idx = (shape.index ??= buildBandIndex(shape.rings, shape.bbox));
  const b = Math.min(BANDS - 1, Math.max(0, Math.floor(((lat - s) / span) * BANDS)));
  const { edges, bandOffsets, bandEdges } = idx;
  let inside = false;
  for (let k = bandOffsets[b], end = bandOffsets[b + 1]; k < end; k++) {
    const o = bandEdges[k];
    const xi = edges[o], yi = edges[o + 1], xj = edges[o + 2], yj = edges[o + 3];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
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
  const bbox: BBox = [w, s, e, n];
  return { rings: out, bbox, index: buildBandIndex(out, bbox) };
}

/** Rings at least this share of the largest ring's area count as the main landmass. */
const MAIN_SHARE = 0.25;

/** Ground area of a ring, up to a constant: shoelace in degrees scaled by cos(mean latitude). */
function ringArea(r: Float64Array): number {
  let a = 0, lat = 0;
  for (let j = 0, k = r.length - 2; j < r.length; k = j, j += 2) {
    a += r[k] * r[j + 1] - r[j] * r[k + 1];
    lat += r[j + 1];
  }
  return Math.abs(a / 2) * Math.cos(((lat / (r.length / 2)) * Math.PI) / 180);
}

/**
 * Box of the main landmass, leaving out far-off islands and territories (Easter Island for Chile,
 * Alaska and Hawaii for the USA, French Guiana for France) that would turn a picture of the area
 * into open ocean.
 */
export function mainBox(shape: Shape): BBox {
  const areas = shape.rings.map(ringArea);
  const max = Math.max(...areas);
  // `w2`/`e2` measure longitudes in 0..360, for landmasses that touch the antimeridian (Russia)
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, w2 = Infinity, e2 = -Infinity;
  shape.rings.forEach((r, i) => {
    if (areas[i] < MAIN_SHARE * max) return;
    for (let j = 0; j < r.length; j += 2) {
      const lon = r[j], lon2 = lon < 0 ? lon + 360 : lon;
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      w2 = Math.min(w2, lon2);
      e2 = Math.max(e2, lon2);
      s = Math.min(s, r[j + 1]);
      n = Math.max(n, r[j + 1]);
    }
  });
  if (!(w < e && s < n)) return shape.bbox;
  return e2 - w2 < e - w ? [w2, s, e2, n] : [w, s, e, n];
}
