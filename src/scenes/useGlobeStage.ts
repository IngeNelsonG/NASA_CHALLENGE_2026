import { useEffect, type RefObject } from 'react';
import { bboxId, clamp, wrapLon } from '@/lib/geo';
import type { BBox } from '@/lib/types';
import { useStore } from '@/store';
import { view, type StageLayout } from './view';

/**
 * Turns a DOM element into a "stage" for the single WebGL globe: the globe centres itself on the
 * element and (when interactive) the element receives the pointer/keyboard controls.
 */
export function useGlobeStage(ref: RefObject<HTMLElement>, id: string, opts: { interactive?: boolean; alpha?: number; layout?: StageLayout } = {}) {
  const { interactive = true, alpha = 1, layout } = opts;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stage = { id, el, ratio: 0, alpha, layout };
    view.stages.set(id, stage);
    const io = new IntersectionObserver(
      ([e]) => {
        // ratio relative to what could possibly be visible, so tall stages still reach 1
        const possible = Math.min(e.boundingClientRect.height, window.innerHeight) * e.boundingClientRect.width || 1;
        stage.ratio = clamp((e.intersectionRect.width * e.intersectionRect.height) / possible, 0, 1);
        view.rectDirty = true;
        view.kick();
      },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      view.stages.delete(id);
      view.kick();
    };
  }, [ref, id, alpha, layout]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return;
    const store = useStore;
    const pointers = new Map<number, { x: number; y: number }>();
    let down: { x: number; y: number; t: number; moved: number; start: { lat: number; lon: number } | null } | null = null;
    let pinch = 0;
    let lastMove = 0;

    const degPerPx = () => clamp(57.3 / (view.radiusPx || 200), 0.01, 1);

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      view.engaged = true;
      view.fly = null;
      view.vLon = view.vLat = 0;
      view.touch();
      if (pointers.size === 1) {
        const rect = store.getState().tool === 'rect';
        down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, start: rect ? view.pick?.(e.clientX, e.clientY) ?? null : null };
        view.dragging = !rect;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        down = null;
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        hover(e);
        return;
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      view.touch();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) view.zoomBy(d / pinch);
        pinch = d;
        return;
      }
      if (!down) return;
      down.moved += Math.abs(dx) + Math.abs(dy);
      if (store.getState().tool === 'rect') {
        const cur = view.pick?.(e.clientX, e.clientY);
        if (down.start && cur) view.draft = toBBox(down.start, cur);
        return;
      }
      const k = degPerPx();
      const now = performance.now();
      const dt = Math.max(1, now - lastMove) / 1000;
      lastMove = now;
      const dLon = -dx * k / Math.max(0.3, Math.cos((view.lat * Math.PI) / 180));
      const dLat = dy * k;
      view.lon = wrapLon(view.lon + dLon);
      view.lat = clamp(view.lat + dLat, -85, 85);
      view.vLon = clamp(dLon / dt, -240, 240);
      view.vLat = clamp(dLat / dt, -240, 240);
    };

    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      view.dragging = false;
      pinch = 0;
      view.touch();
      if (!down) return;
      const d = down;
      down = null;
      if (performance.now() - lastMove > 90) view.vLon = view.vLat = 0;
      if (store.getState().tool === 'rect') {
        const b = view.draft;
        view.draft = null;
        if (b && b[2] - b[0] > 0.2 && b[3] - b[1] > 0.2) {
          store.getState().setAoi({ id: bboxId(b), name: store.getState().lang === 'es' ? 'Área personalizada' : 'Custom area', bbox: b });
        }
        store.getState().set({ tool: 'pan' });
        return;
      }
      if (d.moved < 6 && performance.now() - d.t < 500) {
        const hit = view.pick?.(e.clientX, e.clientY);
        if (hit) store.getState().set({ picked: hit });
      }
    };

    const onDbl = (e: MouseEvent) => {
      const hit = view.pick?.(e.clientX, e.clientY);
      if (hit) view.flyTo(hit.lon, hit.lat, view.zoom * 1.7);
    };

    const onWheel = (e: WheelEvent) => {
      // cooperative: the page keeps scrolling until the user has clicked the globe (or holds ctrl)
      if (!view.engaged && !e.ctrlKey) return;
      e.preventDefault();
      view.zoomBy(Math.exp(-e.deltaY * 0.0016));
    };

    const onLeave = () => {
      if (pointers.size === 0) view.engaged = false;
      if (store.getState().hoverSat) store.getState().set({ hoverSat: null });
    };

    const hover = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      let best: (typeof view.satScreen)[number] | null = null, bd = 22;
      for (const s of view.satScreen) {
        if (!s.visible) continue;
        const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
        if (d < bd) (bd = d), (best = s);
      }
      const cur = store.getState().hoverSat;
      if (best) {
        if (!cur || cur.norad !== best.norad || Math.abs(cur.x - best.x) > 2 || Math.abs(cur.y - best.y) > 2)
          store.getState().set({ hoverSat: { norad: best.norad, x: best.x, y: best.y } });
      } else if (cur) store.getState().set({ hoverSat: null });
    };

    const onKey = (e: KeyboardEvent) => {
      const step = 8 / view.zoom;
      const c = { lon: view.fly?.lon ?? view.lon, lat: view.fly?.lat ?? view.lat };
      if (e.key === 'ArrowLeft') view.flyTo(c.lon - step, c.lat);
      else if (e.key === 'ArrowRight') view.flyTo(c.lon + step, c.lat);
      else if (e.key === 'ArrowUp') view.flyTo(c.lon, c.lat + step);
      else if (e.key === 'ArrowDown') view.flyTo(c.lon, c.lat - step);
      else if (e.key === '+' || e.key === '=') view.zoomBy(1.3);
      else if (e.key === '-' || e.key === '_') view.zoomBy(1 / 1.3);
      else if (e.key === 'Enter') store.getState().set({ picked: { lat: view.lat, lon: view.lon } });
      else if (e.key === 'Escape') (view.engaged = false), store.getState().set({ tool: 'pan' });
      else return;
      e.preventDefault();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('dblclick', onDbl);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('dblclick', onDbl);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    };
  }, [ref, interactive]);
}

export function toBBox(a: { lat: number; lon: number }, b: { lat: number; lon: number }): BBox {
  const r = (v: number) => Math.round(v * 100) / 100;
  return [r(Math.min(a.lon, b.lon)), r(Math.min(a.lat, b.lat)), r(Math.max(a.lon, b.lon)), r(Math.max(a.lat, b.lat))];
}
