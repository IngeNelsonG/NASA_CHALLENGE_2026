import { create } from 'zustand';
import type { Sat } from '@/lib/satellites';
import type { Shape } from '@/lib/shape';
import type { HotspotBuffers, HotspotCoverage } from '@/lib/types';

/**
 * Render-ready data shared with the WebGL scene. React context (TanStack Query) does not cross the
 * react-three-fiber reconciler, so DOM-side loaders publish their results here.
 */
export const useData = create<{
  hotspots: HotspotBuffers | null;
  hotspotsLoading: boolean;
  sats: Sat[];
  /** real outline of the current area (null → draw its bbox, e.g. a drawn rectangle) */
  shape: Shape | null;
  /** id of the area `shape` belongs to, so stale outlines are never drawn for a new area */
  shapeFor: string;
  coverage: HotspotCoverage | null;
}>(() => ({
  hotspots: null,
  hotspotsLoading: false,
  sats: [],
  shape: null,
  shapeFor: '',
  coverage: null,
}));
