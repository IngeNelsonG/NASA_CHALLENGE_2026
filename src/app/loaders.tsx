import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { RECORD_START } from '@/lib/env';
import { todayIso } from '@/lib/geo';
import { countryGeometry, ringsOf, toShape } from '@/lib/shape';
import { simClock } from '@/lib/simClock';
import type { Resolution } from '@/lib/types';
import { callWorker } from '@/lib/worker-client';
import { view } from '@/scenes/view';
import { timelineRange, useStore } from '@/store';
import { useData } from '@/store/data';

export const calendarKey = (aoiId: string, resolution: Resolution) => `${aoiId}|${resolution}`;

/** Calendar for the current AOI at a resolution; fetched + aggregated in the worker and cached. */
export function useCalendar(resolution: Resolution, enabled = true) {
  const aoiId = useStore((s) => s.aoi.id);
  const to = todayIso();
  return useQuery({
    queryKey: ['calendar', aoiId, resolution, to],
    queryFn: () => callWorker('calendar', { aoi: aoiId, from: RECORD_START, to, resolution }),
    enabled,
  });
}

/** Headless: loads TLEs and the hotspots for the timeline window, and publishes them to the scene store. */
export function DataLoaders() {
  const phase = useStore((s) => s.phase);
  const aoi = useStore((s) => s.aoi);
  const date = useStore((s) => s.date);
  const granularity = useStore((s) => s.granularity);

  const timeScale = useStore((s) => s.timeScale);
  useEffect(() => {
    simClock.setScale(timeScale);
    view.kick();
  }, [timeScale]);

  const tle = useQuery({
    queryKey: ['tle'],
    queryFn: async ({ signal }) => {
      const [tles, { buildSats }] = await Promise.all([api.tle(signal), import('@/lib/satellites')]);
      return buildSats(tles);
    },
  });
  useEffect(() => {
    if (tle.data) {
      useData.setState({ sats: tle.data });
      view.kick();
    }
  }, [tle.data]);

  // Real outline of the area: departments/subdivisions from the API, countries from the Natural
  // Earth layer already used for borders. Drawn rectangles and preset boxes have none.
  const outline = useQuery({
    queryKey: ['aoi-shape', aoi.id],
    queryFn: async ({ signal }) => {
      try {
        const g = await api.aoiGeometry(aoi.id, signal);
        if (g.geometry) return toShape(g.geometry);
        if (g.kind === 'country' || g.kind === 'colombia_all') return toShape(await countryGeometry(g.country ?? aoi.name));
      } catch {
        /* unknown to the API (e.g. a drawn box): keep the rectangle */
      }
      return null;
    },
    enabled: phase === 'landing',
    staleTime: Infinity,
  });
  const shapeReady = outline.isFetched;
  const shape = outline.data ?? null;
  useEffect(() => {
    if (!shapeReady) return;
    useData.setState({ shape, shapeFor: aoi.id });
    view.kick();
  }, [shape, shapeReady, aoi.id]);

  const range = timelineRange(date, granularity);
  const coverage = useQuery({
    queryKey: ['coverage', aoi.bbox.join(','), range.from, range.to],
    queryFn: ({ signal }) => api.hotspotsCoverage({ bbox: aoi.bbox, ...range }, signal),
    enabled: phase === 'landing',
    placeholderData: keepPreviousData,
  });
  useEffect(() => useData.setState({ coverage: coverage.data ?? null }), [coverage.data]);

  const hot = useQuery({
    queryKey: ['hotspots', aoi.id, aoi.bbox.join(','), range.from, range.to, !!shape],
    queryFn: () => callWorker('hotspots', { bbox: aoi.bbox, from: range.from, to: range.to, track: true, rings: ringsOf(shape) }),
    // wait for the outline so the points are clipped once, not fetched twice
    enabled: phase === 'landing' && shapeReady,
    placeholderData: keepPreviousData,
    gcTime: 60_000,
  });
  useEffect(() => {
    useData.setState({ hotspots: hot.data ?? null, hotspotsLoading: hot.isFetching });
    view.kick();
  }, [hot.data, hot.isFetching]);

  // When the AOI changes, park the timeline on its most recent peak month so the globe is not empty.
  const monthly = useCalendar('month', phase === 'landing');
  const parked = useRef('');
  useEffect(() => {
    const cells = monthly.data?.response.cells;
    if (!cells || monthly.data?.response.aoi.id !== aoi.id || parked.current === aoi.id) return;
    parked.current = aoi.id;
    let best = cells[cells.length - 1];
    for (const c of cells.slice(-24)) if ((c.harmonized ?? -1) > (best?.harmonized ?? -1)) best = c;
    if (best) useStore.getState().set({ date: best.date, granularity: 'month' });
  }, [monthly.data, aoi.id]);

  return null;
}
