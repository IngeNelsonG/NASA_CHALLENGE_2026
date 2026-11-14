import { create } from 'zustand';
import type { Sat } from '@/lib/satellites';
import type { HotspotBuffers } from '@/lib/types';

/**
 * Render-ready data shared with the WebGL scene. React context (TanStack Query) does not cross the
 * react-three-fiber reconciler, so DOM-side loaders publish their results here.
 */
export const useData = create<{ hotspots: HotspotBuffers | null; hotspotsLoading: boolean; sats: Sat[] }>(() => ({
  hotspots: null,
  hotspotsLoading: false,
  sats: [],
}));
