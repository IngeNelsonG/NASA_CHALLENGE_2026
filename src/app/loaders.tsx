import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { RECORD_START } from '@/lib/env';
import { todayIso } from '@/lib/geo';
import { countryGeometry, ringsOf, toShape } from '@/lib/shape';
import { simClock } from '@/lib/simClock';
import type { Resolution, TLE } from '@/lib/types';
import { callWorker } from '@/lib/worker-client';
import { view } from '@/scenes/view';
import { isWorld, timelineRange, useStore } from '@/store';
import { useData } from '@/store/data';

/** First day of the month `k` months away from `date`. */
const monthStart = (date: string, k: number) => new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1 + k, 1)).toISOString().slice(0, 10);

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
  // nothing selected: no outline and no points (the whole planet would be far too many)
  const world = isWorld(aoi);

  const timeScale = useStore((s) => s.timeScale);
  useEffect(() => {
    simClock.setScale(timeScale);
    view.kick();
  }, [timeScale]);

  const tle = useQuery({
    queryKey: ['tle'],
    queryFn: async ({ signal }) => {
      // the satellites are decoration as much as data: if the API is unreachable, orbit with the
      // TLE snapshot shipped in the bundle instead of leaving the sky empty
      const tles = await api.tle(signal).catch(async () => (await import('@/mocks/tle.json')).default as TLE[]);
      const { buildSats } = await import('@/lib/satellites');
      return buildSats(tles);
    },
    retry: false,
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
    enabled: phase === 'landing' && !world,
    staleTime: Infinity,
  });
  const shapeReady = outline.isFetched || world;
  const shape = world ? null : outline.data ?? null;
  useEffect(() => {
    if (!shapeReady) return;
    useData.setState({ shape, shapeFor: aoi.id });
    view.kick();
  }, [shape, shapeReady, aoi.id]);

  const range = timelineRange(date, granularity);
  const coverage = useQuery({
    queryKey: ['coverage', aoi.bbox.join(','), range.from, range.to],
    queryFn: ({ signal }) => api.hotspotsCoverage({ bbox: aoi.bbox, ...range }, signal),
    enabled: phase === 'landing' && !world,
    placeholderData: keepPreviousData,
  });
  useEffect(() => useData.setState({ coverage: world ? null : coverage.data ?? null }), [coverage.data, world]);

  // When the AOI changes, park the timeline on its most recent peak month so the globe is not empty.
  const monthly = useCalendar('month', phase === 'landing');
  // the points wait for this: fetching the month the timeline happened to be on would be thrown away
  const [parkedFor, setParkedFor] = useState('');
  // timeline position when the area changed: if the user moves it before the calendar arrives,
  // their choice wins and the timeline is not yanked back to the peak month
  const atSelect = useRef({ aoi: '', date: '', granularity: '' });
  useEffect(() => {
    const s = useStore.getState();
    atSelect.current = { aoi: aoi.id, date: s.date, granularity: s.granularity };
  }, [aoi.id]);
  useEffect(() => {
    const cells = monthly.data?.response.cells;
    if (!cells || monthly.data?.response.aoi.id !== aoi.id || parkedFor === aoi.id) return;
    setParkedFor(aoi.id);
    const s = useStore.getState(), at = atSelect.current;
    if (at.aoi === aoi.id && (s.date !== at.date || s.granularity !== at.granularity)) return;
    let best = cells[cells.length - 1];
    for (const c of cells.slice(-24)) if ((c.harmonized ?? -1) > (best?.harmonized ?? -1)) best = c;
    if (best) useStore.getState().set({ date: best.date, granularity: 'month' });
  }, [monthly.data, aoi.id, parkedFor]);

  const hot = useQuery({
    queryKey: ['hotspots', aoi.id, aoi.bbox.join(','), range.from, range.to, !!shape],
    queryFn: () => callWorker('hotspots', { bbox: aoi.bbox, from: range.from, to: range.to, track: true, rings: ringsOf(shape) }),
    // wait for the outline so the points are clipped once, not fetched twice
    enabled: phase === 'landing' && !world && shapeReady && (parkedFor === aoi.id || monthly.isError),
    placeholderData: keepPreviousData,
    gcTime: 60_000,
  });
  useEffect(() => {
    useData.setState({ hotspots: world ? null : hot.data ?? null, hotspotsLoading: !world && hot.isFetching });
    view.kick();
  }, [hot.data, hot.isFetching, world]);

  // Outside Colombia the points come live from NASA FIRMS (slow): once this period is shown, ask the
  // server to download the neighbouring ones in the background, so stepping or playing is instant.
  // A day view warms its whole month (any day inside a downloaded month is then free).
  const source = coverage.data?.source;
  const hotReady = !!hot.data && !hot.isFetching;
  useEffect(() => {
    if (!hotReady || source !== 'firms' || granularity === 'year') return;
    const spans = granularity === 'day' ? [timelineRange(date, 'month')] : [1, -1].map((k) => timelineRange(monthStart(date, k), 'month'));
    for (const r of spans) if (r.from <= todayIso()) api.hotspotsWarm({ bbox: aoi.bbox, ...r }).catch(() => undefined);
  }, [hotReady, source, date, granularity, aoi.bbox]);

  return null;
}
