import { geoCircle, geoEqualEarth, geoGraticule10, geoPath } from 'd3-geo';
import { useEffect, useRef } from 'react';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection } from 'topojson-specification';
import { CHART, fireRGB, HOTSPOT_COLOR, SENSOR_COLOR } from '@/lib/colors';
import { bboxCenter, bboxId, bboxSpan, clamp, DEG, subsolar } from '@/lib/geo';
import { satScenePos, sceneToGeodetic } from '@/lib/satellites';
import { simClock } from '@/lib/simClock';
import type { BBox } from '@/lib/types';
import { loadWorld } from '@/lib/world';
import { toBBox } from '@/scenes/useGlobeStage';
import { view } from '@/scenes/view';
import { selectAt, useStore, WORLD_ID } from '@/store';
import { useData } from '@/store/data';

const bboxPolygon = (b: BBox): GeoJSON.Polygon => {
  const ring: [number, number][] = [];
  const c: [number, number][] = [[b[0], b[1]], [b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 8; k++) ring.push([c[i][0] + ((c[i + 1][0] - c[i][0]) * k) / 8, c[i][1] + ((c[i + 1][1] - c[i][1]) * k) / 8]);
  ring.push(c[0]);
  return { type: 'Polygon', coordinates: [ring] };
};

/**
 * Equal Earth map on a 2D canvas. Same layers and interactions as the globe; it is the fallback when
 * WebGL2 is missing or the device is low-end, and the "2D" side of the view toggle.
 */
export function Map2D({ interactive = true }: { interactive?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let W = 1, H = 1, s0 = 1, t0: [number, number] = [0, 0];
    let dirty = true, raf = 0, onScreen = true;
    let land: GeoJSON.Feature | GeoJSON.FeatureCollection | null = null;
    let borders: GeoJSON.MultiLineString | null = null;
    const tf = { k: 1, x: 0, y: 0 };
    const proj = geoEqualEarth();
    const path = geoPath(proj, ctx);
    const night = geoCircle().radius(90).precision(2);
    const mark = () => (dirty = true);

    const applyTf = () => proj.scale(s0 * tf.k).translate([t0[0] * tf.k + tf.x, t0[1] * tf.k + tf.y]);
    const centerOn = (lon: number, lat: number, k: number) => {
      tf.k = clamp(k, 1, 60);
      tf.x = tf.y = 0;
      applyTf();
      const p = proj([lon, lat]);
      if (p) (tf.x = W / 2 - p[0]), (tf.y = H / 2 - p[1]);
      mark();
    };
    const fitAoi = (b: BBox) => {
      const c = bboxCenter(b);
      centerOn(c.lon, c.lat, interactive ? 70 / Math.max(2, bboxSpan(b)) : 1);
    };
    const zoomAt = (f: number, px: number, py: number) => {
      const k = clamp(tf.k * f, 1, 60), r = k / tf.k;
      tf.x = px - (px - tf.x) * r;
      tf.y = py - (py - tf.y) * r;
      tf.k = k;
      mark();
    };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      proj.fitExtent([[6, 6], [W - 6, H - 6]], { type: 'Sphere' });
      s0 = proj.scale();
      t0 = proj.translate();
      mark();
    };

    const draw = () => {
      const { layers, aoi } = useStore.getState();
      const { hotspots, sats, shape, shapeFor } = useData.getState();
      applyTf();
      ctx.clearRect(0, 0, W, H);
      ctx.lineJoin = 'round';
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.fillStyle = '#0a1630';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      path(geoGraticule10());
      ctx.strokeStyle = CHART.grid;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      if (land) {
        ctx.beginPath();
        path(land);
        ctx.fillStyle = '#1a2b50';
        ctx.fill();
      }
      if (borders && layers.borders) {
        ctx.beginPath();
        path(borders);
        ctx.strokeStyle = 'rgba(184,200,234,0.38)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      const now = simClock.now();
      if (layers.terminator) {
        const sun = subsolar(Date.now());
        ctx.beginPath();
        path(night.center([sun.lon + 180, -sun.lat])());
        ctx.fillStyle = 'rgba(2,4,12,0.5)';
        ctx.fill();
      }
      if (hotspots && layers.density) {
        const R = hotspots.hexRadiusDeg * 0.94;
        ctx.globalAlpha = 0.82;
        for (let i = 0; i < hotspots.hex.length; i += 3) {
          const lon = hotspots.hex[i], lat = hotspots.hex[i + 1];
          const cl = Math.cos(lat * DEG) || 1;
          ctx.beginPath();
          for (let a = 0; a < 6; a++) {
            const p = proj([lon + (R * Math.cos((a * Math.PI) / 3)) / cl, lat + R * Math.sin((a * Math.PI) / 3)]);
            if (p) a ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]);
          }
          ctx.closePath();
          const [r, g, b] = fireRGB(Math.sqrt(hotspots.hex[i + 2]));
          ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (hotspots) {
        const size = clamp(1.2 + tf.k * 0.12, 1.5, 6);
        {
          ctx.fillStyle = HOTSPOT_COLOR;
          ctx.globalAlpha = 0.85;
          const s = size * 0.8;
          for (let i = 0; i < hotspots.count; i++) {
            const p = proj([hotspots.lonlat[i * 2], hotspots.lonlat[i * 2 + 1]]);
            if (!p || p[0] < -4 || p[1] < -4 || p[0] > W + 4 || p[1] > H + 4) continue;
            ctx.fillRect(p[0] - s / 2, p[1] - s / 2, s, s);
          }
        }
        ctx.globalAlpha = 1;
      }
      // real outline when known (rings as closed paths), the box for drawn areas
      if (shapeFor === aoi.id && aoi.id !== WORLD_ID) {
        ctx.beginPath();
        if (shape)
          for (const ring of shape.rings) {
            const coords: [number, number][] = [];
            for (let i = 0; i + 1 < ring.length; i += 2) coords.push([ring[i], ring[i + 1]]);
            path({ type: 'LineString', coordinates: coords });
          }
        else path(bboxPolygon(aoi.bbox));
        ctx.strokeStyle = SENSOR_COLOR.harmonized;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (view.draft) {
        ctx.beginPath();
        path(bboxPolygon(view.draft));
        ctx.strokeStyle = '#fff';
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const rect = canvas.getBoundingClientRect();
      const tmp = [0, 0, 0];
      sats.forEach((sat, i) => {
        const color = sat.meta.instrument === 'MODIS' ? SENSOR_COLOR.modis : SENSOR_COLOR.viirs;
        if (layers.orbits) {
          const coords: [number, number][] = [];
          const step = (sat.periodMin * 60_000 * 0.9) / 63;
          for (let k = 0; k < 64; k++) {
            if (!satScenePos(sat.rec, now - k * step, tmp)) continue;
            const g = sceneToGeodetic(tmp[0], tmp[1], tmp[2]);
            coords.push([g.lon, g.lat]);
          }
          ctx.beginPath();
          path({ type: 'LineString', coordinates: coords });
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.4;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        const slot = (view.satScreen[i] ??= { norad: sat.norad, x: 0, y: 0, visible: false });
        slot.norad = sat.norad;
        slot.visible = false;
        if (!satScenePos(sat.rec, now, tmp)) return;
        const g = sceneToGeodetic(tmp[0], tmp[1], tmp[2]);
        const p = proj([g.lon, g.lat]);
        if (!p) return;
        const r = sat.meta.primary ? 5 : 3.5;
        ctx.beginPath();
        ctx.arc(p[0], p[1], r, 0, 6.2832);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#0a1630';
        ctx.stroke();
        if (interactive) Object.assign(slot, { x: rect.left + p[0], y: rect.top + p[1], visible: true });
      });
      ctx.restore();
      ctx.beginPath();
      path({ type: 'Sphere' });
      ctx.strokeStyle = CHART.grid;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!dirty || !onScreen || document.hidden) return;
      dirty = false;
      draw();
    };

    resize();
    fitAoi(useStore.getState().aoi.bbox);
    void loadWorld().then((w) => {
      land = feature(w, w.objects.land as GeometryCollection);
      borders = mesh(w, w.objects.countries as GeometryCollection, (a, b) => a !== b);
      mark();
    });
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => ((onScreen = e.isIntersecting), mark()));
    io.observe(canvas);
    const unsubA = useStore.subscribe((s, prev) => {
      if (s.aoi !== prev.aoi) fitAoi(s.aoi.bbox);
      mark();
    });
    const unsubB = useData.subscribe(mark);
    const tick = window.setInterval(mark, 200);
    raf = requestAnimationFrame(loop);

    const cleanup: (() => void)[] = [() => cancelAnimationFrame(raf), () => ro.disconnect(), () => io.disconnect(), unsubA, unsubB, () => clearInterval(tick)];

    if (interactive) {
      const store = useStore;
      const local = (e: MouseEvent) => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top] as [number, number];
      };
      const geo = (e: MouseEvent) => {
        applyTf();
        const p = proj.invert?.(local(e));
        return p && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180 ? { lon: p[0], lat: p[1] } : null;
      };
      view.map2d = {
        zoomBy: (f) => zoomAt(f, W / 2, H / 2),
        flyTo: (lon, lat, zoom) => centerOn(lon, lat, zoom ? zoom * 2.4 : tf.k),
      };
      let down: { x: number; y: number; moved: number; start: { lat: number; lon: number } | null } | null = null;
      const onDown = (e: PointerEvent) => {
        canvas.setPointerCapture(e.pointerId);
        view.engaged = true;
        down = { x: e.clientX, y: e.clientY, moved: 0, start: store.getState().tool === 'rect' ? geo(e) : null };
      };
      const onMove = (e: PointerEvent) => {
        if (!down) {
          let best: (typeof view.satScreen)[number] | null = null, bd = 16;
          for (const s of view.satScreen) {
            const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
            if (s.visible && d < bd) (bd = d), (best = s);
          }
          const cur = store.getState().hoverSat;
          if (best && cur?.norad !== best.norad) store.getState().set({ hoverSat: { norad: best.norad, x: best.x, y: best.y } });
          else if (!best && cur) store.getState().set({ hoverSat: null });
          return;
        }
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        down.x = e.clientX;
        down.y = e.clientY;
        down.moved += Math.abs(dx) + Math.abs(dy);
        if (store.getState().tool === 'rect') {
          const cur = geo(e);
          if (down.start && cur) view.draft = toBBox(down.start, cur);
        } else {
          tf.x += dx;
          tf.y += dy;
        }
        mark();
      };
      const onUp = (e: PointerEvent) => {
        const d = down;
        down = null;
        if (!d) return;
        if (store.getState().tool === 'rect') {
          const b = view.draft;
          view.draft = null;
          if (b && b[2] - b[0] > 0.2 && b[3] - b[1] > 0.2) store.getState().setAoi({ id: bboxId(b), name: store.getState().lang === 'es' ? 'Área personalizada' : 'Custom area', bbox: b });
          store.getState().set({ tool: 'pan' });
        } else if (d.moved < 6) {
          const hit = geo(e);
          if (hit) void selectAt(hit);
        }
        mark();
      };
      const onWheel = (e: WheelEvent) => {
        if (!view.engaged && !e.ctrlKey) return;
        e.preventDefault();
        const [x, y] = local(e);
        zoomAt(Math.exp(-e.deltaY * 0.0016), x, y);
      };
      const onDbl = (e: MouseEvent) => zoomAt(1.8, ...local(e));
      const onLeave = () => {
        view.engaged = false;
        if (store.getState().hoverSat) store.getState().set({ hoverSat: null });
      };
      const onKey = (e: KeyboardEvent) => {
        const step = 60;
        if (e.key === 'ArrowLeft') tf.x += step;
        else if (e.key === 'ArrowRight') tf.x -= step;
        else if (e.key === 'ArrowUp') tf.y += step;
        else if (e.key === 'ArrowDown') tf.y -= step;
        else if (e.key === '+' || e.key === '=') zoomAt(1.3, W / 2, H / 2);
        else if (e.key === '-') zoomAt(1 / 1.3, W / 2, H / 2);
        else return;
        e.preventDefault();
        mark();
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('pointercancel', onUp);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('dblclick', onDbl);
      canvas.addEventListener('keydown', onKey);
      cleanup.push(() => {
        view.map2d = null;
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('wheel', onWheel);
        canvas.removeEventListener('dblclick', onDbl);
        canvas.removeEventListener('keydown', onKey);
      });
    }
    return () => cleanup.forEach((f) => f());
  }, [interactive]);

  return <canvas ref={ref} tabIndex={interactive ? 0 : -1} aria-hidden={!interactive} className="absolute inset-0 h-full w-full touch-none" />;
}
