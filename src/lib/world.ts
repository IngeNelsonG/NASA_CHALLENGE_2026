import type { Topology } from 'topojson-specification';
import worldUrl from 'world-atlas/countries-50m.json?url';

let cached: Promise<Topology> | null = null;
/** Natural Earth 1:50m countries (via world-atlas), fetched once and shared by the globe and the 2D map. */
export function loadWorld(): Promise<Topology> {
  cached ??= fetch(worldUrl).then((r) => r.json() as Promise<Topology>);
  return cached;
}
