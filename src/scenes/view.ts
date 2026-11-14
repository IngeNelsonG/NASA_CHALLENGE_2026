// Mutable view state shared between the DOM (stages, controls) and the WebGL scene.
// Deliberately free of three.js imports so the landing can use it without pulling the 3D chunk.
import { clamp, wrapLon } from '@/lib/geo';
import type { BBox } from '@/lib/types';

export const ZOOM_MIN = 0.7;
export const ZOOM_MAX = 6;

/** Where the globe sits for a stage: centre (viewport px) and radius at zoom 1. */
export type StageLayout = (rect: DOMRect) => { cx: number; cy: number; r: number };
type Stage = { id: string; el: HTMLElement; ratio: number; alpha: number; layout?: StageLayout };

export const view = {
  // camera sub-point and zoom (1 = globe fits its stage)
  lon: -70,
  lat: 8,
  zoom: 1,
  vLon: 0,
  vLat: 0,
  fly: null as { lon: number; lat: number; zoom: number } | null,
  dragging: false,
  engaged: false,
  lastInteract: -1e9,
  kickAt: 0,
  /** rectangle being drawn with the AOI tool */
  draft: null as BBox | null,
  /** intro-driven multipliers */
  intro: { dolly: 1, sats: 1 },
  // written by the scene every frame
  radiusPx: 200,
  centerX: 0,
  centerY: 0,
  satScreen: [] as { norad: number; x: number; y: number; visible: boolean }[],
  // hooks installed by the scene
  invalidate: null as (() => void) | null,
  pick: null as ((clientX: number, clientY: number) => { lat: number; lon: number } | null) | null,

  /** installed by the interactive 2D map so the same buttons drive both views */
  map2d: null as { zoomBy: (f: number) => void; flyTo: (lon: number, lat: number, zoom?: number) => void } | null,

  stages: new Map<string, Stage>(),
  rectDirty: true,

  /** Ask for frames for the next ~0.6 s (scroll, state changes…). */
  kick() {
    view.kickAt = performance.now();
    view.invalidate?.();
  },
  touch() {
    view.lastInteract = performance.now();
    view.kick();
  },
  flyTo(lon: number, lat: number, zoom?: number) {
    view.fly = { lon: wrapLon(lon), lat: clamp(lat, -85, 85), zoom: clamp(zoom ?? view.zoom, ZOOM_MIN, ZOOM_MAX) };
    view.vLon = view.vLat = 0;
    view.map2d?.flyTo(lon, lat, zoom);
    view.touch();
  },
  zoomBy(f: number) {
    const z = clamp((view.fly?.zoom ?? view.zoom) * f, ZOOM_MIN, ZOOM_MAX);
    if (view.fly) view.fly.zoom = z;
    else view.zoom = z;
    view.map2d?.zoomBy(f);
    view.touch();
  },
  activeStage(): Stage | null {
    let best: Stage | null = null;
    for (const s of view.stages.values()) if (s.ratio > 0.02 && (!best || s.ratio >= best.ratio)) best = s;
    return best;
  },
};

if (typeof window !== 'undefined') {
  const dirty = () => {
    view.rectDirty = true;
    view.kick();
  };
  window.addEventListener('scroll', dirty, { passive: true });
  window.addEventListener('resize', dirty, { passive: true });
}
