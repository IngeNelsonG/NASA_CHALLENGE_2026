import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { RECORD_START } from '@/lib/env';
import { todayIso } from '@/lib/geo';
import { buildSats } from '@/lib/satellites';
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

  const tle = useQuery({ queryKey: ['tle'], queryFn: ({ signal }) => api.tle(signal) });
  useEffect(() => {
    if (tle.data) {
      useData.setState({ sats: buildSats(tle.data) });
      view.kick();
    }
  }, [tle.data]);

  const range = timelineRange(date, granularity);
  const hot = useQuery({
    queryKey: ['hotspots', aoi.bbox.join(','), range.from, range.to],
    queryFn: () => callWorker('hotspots', { bbox: aoi.bbox, from: range.from, to: range.to, track: true }),
    enabled: phase === 'landing',
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
