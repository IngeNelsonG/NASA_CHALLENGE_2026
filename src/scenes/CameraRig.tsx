import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { PerspectiveCamera, Raycaster, Vector2 } from 'three';
import { reducedMotion } from '@/lib/capabilities';
import { clamp, latLonToXYZ, wrapLon, xyzToLatLon } from '@/lib/geo';
import { simClock } from '@/lib/simClock';
import { useStore } from '@/store';
import { view } from './view';

const FOV = 30;
const F = 1 / Math.tan((FOV * Math.PI) / 360);
/** Frame rate for the ambient motion (idle spin, satellites) while docked, i.e. on phones/tablets. */
const DOCKED_AMBIENT_FPS = 30;

const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

const coarse = typeof matchMedia !== 'undefined' ? matchMedia('(pointer: coarse)') : null;
/** Touch screens and narrow windows anchor the canvas to the stage instead of the viewport. */
const wantsDock = () => !!coarse?.matches || window.innerWidth < 1024;

const DOCK_PROPS = ['position', 'inset', 'left', 'top', 'width', 'height'] as const;

/**
 * Drives the camera from `view` (lon/lat/zoom), keeps the globe on the active DOM stage, fades the
 * canvas when no stage is visible and decides when frames are needed.
 *
 * Two placements:
 * - desktop: the canvas covers the viewport (fixed) and a projection view-offset glues the globe to
 *   the stage; between stages the globe glides from one to the other.
 * - docked (touch / narrow): the canvas is moved over the stage itself, in page coordinates, so it
 *   scrolls natively with the page. Re-aiming a fixed canvas on every scroll frame lags behind the
 *   finger on phones and makes the globe swim and bounce.
 */
export function CameraRig() {
  const { camera, size, invalidate, gl } = useThree();
  const s = useRef({
    init: false,
    stage: '',
    tx: 0,
    ty: 0,
    tf: 200,
    ox: 0,
    oy: 0,
    of: 0,
    alpha: 0,
    rect: null as DOMRect | null,
    rectStage: '',
    /** page scroll when `rect` was measured: rect + scroll = page position */
    scrollX: 0,
    scrollY: 0,
    dockKey: '',
    timer: 0,
  });

  useEffect(() => {
    const ray = new Raycaster();
    const ndc = new Vector2();
    view.invalidate = invalidate;
    view.pick = (cx, cy) => {
      const rc = gl.domElement.getBoundingClientRect();
      ndc.set(((cx - rc.left) / rc.width) * 2 - 1, -(((cy - rc.top) / rc.height) * 2 - 1));
      ray.setFromCamera(ndc, camera);
      const o = ray.ray.origin, d = ray.ray.direction;
      const b = o.dot(d), disc = b * b - (o.dot(o) - 1);
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      return xyzToLatLon(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t);
    };
    const renderable = () => !document.hidden && useStore.getState().viewMode === '3d' && (s.current.alpha > 0.004 || view.activeStage() !== null);
    // low-rate heartbeat: the terminator creeps even when nothing else moves
    const beat = window.setInterval(() => {
      if (renderable()) invalidate();
    }, 250);
    const vis = () => view.kick();
    document.addEventListener('visibilitychange', vis);
    invalidate();
    const st = s.current;
    return () => {
      clearInterval(beat);
      clearTimeout(st.timer);
      document.removeEventListener('visibilitychange', vis);
      view.invalidate = null;
      view.pick = null;
    };
  }, [camera, invalidate, gl]);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.1, rawDt);
    const st = s.current;
    const state = useStore.getState();
    const { phase, viewMode, tool, hoverSat } = state;
    const W = size.width, H = size.height;
    const now = performance.now();
    const layer = (camera.userData.layer ??= document.getElementById('globe-layer')) as HTMLElement | null;

    // ---- placement mode ----
    const docked = phase === 'landing' && wantsDock();
    if (docked !== view.docked) {
      view.docked = docked;
      view.rectDirty = true;
      st.dockKey = '';
      if (!docked && layer) for (const p of DOCK_PROPS) layer.style[p] = '';
    }

    // ---- layout target ----
    const stage = view.activeStage();
    let ta = 0;
    let sid = st.stage;
    if (stage) {
      if (view.rectDirty || !st.rect || st.rectStage !== stage.id) {
        st.rect = stage.el.getBoundingClientRect();
        st.rectStage = stage.id;
        st.scrollX = window.scrollX;
        st.scrollY = window.scrollY;
        view.rectDirty = false;
      }
      const r = st.rect;
      // docked: the canvas sits on the stage, so stage coordinates are canvas coordinates
      const ox = docked ? r.left : 0, oy = docked ? r.top : 0;
      // default: centred and fitted; a stage may place the globe itself (e.g. the hero horizon)
      const custom = stage.layout?.(r);
      st.tx = (custom ? custom.cx : r.left + r.width / 2) - ox;
      st.ty = (custom ? custom.cy : r.top + r.height / 2) - oy;
      st.tf = custom ? custom.r : 0.43 * Math.min(r.width, r.height);
      view.originX = ox;
      view.originY = oy;
      // a docked canvas leaves the screen with its stage: no need to fade it with the scroll
      ta = docked ? stage.alpha : stage.alpha * smooth(0.04, 0.4, stage.ratio);
      sid = stage.id;
      if (docked && layer) {
        const left = Math.round(r.left + st.scrollX), top = Math.round(r.top + st.scrollY);
        const w = Math.round(r.width), h = Math.round(r.height);
        const key = `${left},${top},${w},${h}`;
        if (key !== st.dockKey) {
          st.dockKey = key;
          Object.assign(layer.style, { position: 'absolute', inset: 'auto', left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
        }
      }
    } else if (phase === 'intro') {
      st.tx = W / 2;
      st.ty = H / 2;
      st.tf = 0.3 * Math.min(W, H);
      ta = 1;
      sid = 'intro';
      view.originX = view.originY = 0;
    }
    if (viewMode === '2d') ta = 0;
    if (!st.init) {
      st.init = true;
      st.stage = sid;
      st.alpha = ta;
    } else if (sid !== st.stage) {
      st.stage = sid;
      if (docked) {
        // the canvas has jumped to the new stage: fade in there, no glide
        st.ox = st.oy = st.of = 0;
        st.alpha = 0;
      } else {
        // keep what is on screen continuous, then ease into the new stage
        st.ox = view.centerX - st.tx;
        st.oy = view.centerY - st.ty;
        st.of = Math.log(Math.max(1, view.radiusPx / Math.max(0.2, view.zoom)) / Math.max(1, st.tf));
      }
    }
    const ease = Math.exp(-dt * 3.2);
    st.ox *= ease;
    st.oy *= ease;
    st.of *= ease;
    st.alpha += (ta - st.alpha) * (1 - Math.exp(-dt * 7));
    const settling = Math.abs(st.ox) + Math.abs(st.oy) > 0.5 || Math.abs(st.of) > 0.002 || Math.abs(ta - st.alpha) > 0.004;

    // ---- controls ----
    let moving = false;
    let spinning = false;
    if (view.fly) {
      const k = 1 - Math.exp(-dt * 3.4);
      const dl = wrapLon(view.fly.lon - view.lon), dp = view.fly.lat - view.lat, dz = Math.log(view.fly.zoom / view.zoom);
      view.lon = wrapLon(view.lon + dl * k);
      view.lat += dp * k;
      view.zoom *= Math.exp(dz * k);
      if (Math.abs(dl) < 0.02 && Math.abs(dp) < 0.02 && Math.abs(dz) < 0.004) view.fly = null;
      moving = true;
    } else if (!view.dragging) {
      if (Math.abs(view.vLon) + Math.abs(view.vLat) > 0.4) {
        view.lon = wrapLon(view.lon + view.vLon * dt);
        view.lat = clamp(view.lat + view.vLat * dt, -85, 85);
        const decay = Math.exp(-dt * 3.5);
        view.vLon *= decay;
        view.vLat *= decay;
        moving = true;
      } else if (now - view.lastInteract > 8000 && view.zoom < 1.4 && tool === 'pan' && !hoverSat && !reducedMotion() && ta > 0) {
        view.lon = wrapLon(view.lon + 2.2 * dt);
        spinning = true;
      }
    }

    // ---- camera ----
    const cam = camera as PerspectiveCamera;
    const cx = st.tx + st.ox, cy = st.ty + st.oy;
    const want = Math.max(8, st.tf * Math.exp(st.of) * view.zoom * (0.42 + 0.58 * view.intro.dolly));
    const d = Math.max(1.13, Math.sqrt(1 + ((H * 0.5 * F) / want) ** 2));
    const [x, y, z] = latLonToXYZ(view.lat, view.lon, d);
    cam.position.set(x, y, z);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.near = Math.max(0.01, d - 1.4);
    cam.far = d + 2;
    cam.setViewOffset(W, H, -(cx - W / 2), -(cy - H / 2), W, H);
    cam.updateMatrixWorld();
    view.centerX = cx;
    view.centerY = cy;
    view.radiusPx = (H * 0.5 * F) / Math.sqrt(d * d - 1);

    if (layer) layer.style.opacity = st.alpha < 0.004 ? '0' : st.alpha.toFixed(3);

    const visible = !document.hidden && viewMode === '3d' && (ta > 0 || st.alpha > 0.004);
    if (!visible) return;
    // a sped-up clock (the default 60x) keeps the satellites gliding; with the idle spin this is
    // ambient motion, drawn at full rate on desktop and at 30 fps on phones and tablets
    const ambient = spinning || simClock.scale > 1;
    const urgent = moving || view.dragging || settling || now - view.kickAt < 600 || phase === 'intro' || !!view.draft;
    if (urgent || (ambient && !docked)) invalidate();
    else if (ambient && !st.timer) {
      st.timer = window.setTimeout(() => {
        st.timer = 0;
        invalidate();
      }, 1000 / DOCKED_AMBIENT_FPS);
    }
  }, -1);

  return null;
}
