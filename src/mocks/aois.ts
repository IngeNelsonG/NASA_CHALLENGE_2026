import type { AOI, BBox } from '@/lib/types';

/** Approximate bounding boxes for the demo gazetteer. `peakDoy` is mock-only (fire-season centre). */
type MockAOI = AOI & { peakDoy: number; kind: string };

const a = (id: string, name: string, kind: string, bbox: BBox, peakDoy: number): MockAOI => ({ id, name, kind, bbox, peakDoy });

export const MOCK_AOIS: MockAOI[] = [
  a('co-orinoquia', 'Orinoquía, Colombia', 'region', [-74.0, 2.0, -67.4, 7.2], 48),
  a('co', 'Colombia', 'country', [-79.1, -4.3, -66.8, 12.6], 52),
  a('co-boyaca', 'Boyacá, Colombia', 'department', [-74.7, 4.6, -71.9, 7.1], 45),
  a('co-casanare', 'Casanare, Colombia', 'department', [-73.1, 4.3, -69.8, 6.4], 46),
  a('co-meta', 'Meta, Colombia', 'department', [-74.9, 1.6, -71.0, 4.9], 50),
  a('co-vichada', 'Vichada, Colombia', 'department', [-71.1, 2.7, -67.4, 6.3], 52),
  a('co-arauca', 'Arauca, Colombia', 'department', [-72.4, 6.0, -69.4, 7.1], 60),
  a('co-paz-de-ariporo', 'Paz de Ariporo, Casanare', 'municipality', [-71.95, 5.5, -70.3, 6.3], 47),
  a('co-puerto-gaitan', 'Puerto Gaitán, Meta', 'municipality', [-72.3, 3.3, -70.6, 4.6], 50),
  a('ar', 'Argentina', 'country', [-73.6, -55.1, -53.6, -21.8], 245),
  a('ar-cordoba', 'Córdoba, Argentina', 'province', [-65.8, -35.0, -61.8, -29.5], 250),
  a('ar-chaco', 'Chaco, Argentina', 'province', [-63.4, -28.0, -58.2, -24.1], 240),
  a('ar-corrientes', 'Corrientes, Argentina', 'province', [-59.7, -30.8, -55.6, -27.2], 235),
  a('br-mato-grosso', 'Mato Grosso, Brazil', 'state', [-61.6, -18.1, -50.2, -7.3], 250),
  a('br-pantanal', 'Pantanal, Brazil', 'region', [-59.2, -22.2, -54.9, -15.5], 258),
  a('us-california', 'California, USA', 'state', [-124.5, 32.5, -114.1, 42.0], 232),
  a('pt', 'Portugal', 'country', [-9.6, 36.9, -6.2, 42.2], 225),
  a('au-nsw', 'New South Wales, Australia', 'state', [141.0, -37.5, 153.6, -28.2], 345),
  a('id-kalimantan', 'Kalimantan, Indonesia', 'region', [108.8, -4.2, 119.0, 4.4], 262),
  a('zm', 'Zambia', 'country', [22.0, -18.1, 33.7, -8.2], 235),
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function searchAois(q: string): AOI[] {
  const n = norm(q.trim());
  const hits = n ? MOCK_AOIS.filter((x) => norm(x.name).includes(n) || x.id.includes(n)) : MOCK_AOIS.slice(0, 8);
  return hits.slice(0, 8).map(({ id, name, bbox }) => ({ id, name, bbox }));
}

/** Resolves gazetteer ids and custom `bbox:W,S,E,N` ids. */
export function resolveAoi(id: string): MockAOI | null {
  // "no area selected" in the app: the whole planet (never a search result)
  if (id === 'world') return { id, name: 'World', kind: 'world', bbox: [-180, -90, 180, 90], peakDoy: 230 };
  const hit = MOCK_AOIS.find((x) => x.id === id);
  if (hit) return hit;
  if (id.startsWith('bbox:')) {
    const p = id.slice(5).split(',').map(Number);
    if (p.length === 4 && p.every(Number.isFinite)) {
      const bbox = p as BBox;
      return { id, name: 'Custom area', kind: 'custom', bbox, peakDoy: peakForLat((bbox[1] + bbox[3]) / 2) };
    }
  }
  return null;
}

export function peakForLat(lat: number): number {
  if (lat >= 23) return 215;
  if (lat >= -2) return 50;
  if (lat >= -35) return 250;
  return 30;
}

const key = (b: BBox) => b.map((v) => v.toFixed(2)).join(',');
export function peakForBBox(b: BBox): number {
  const k = key(b);
  return MOCK_AOIS.find((x) => key(x.bbox) === k)?.peakDoy ?? peakForLat((b[1] + b[3]) / 2);
}
