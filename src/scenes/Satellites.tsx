import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, CanvasTexture, Color, type Group, Line, LineBasicMaterial, Vector3 } from 'three';
import { SENSOR_COLOR } from '@/lib/colors';
import { satScenePos, type Sat } from '@/lib/satellites';
import { simClock } from '@/lib/simClock';
import { useStore } from '@/store';
import { useData } from '@/store/data';
import { view } from './view';

const TRAIL_POINTS = 96;
const colorOf = (s: Sat) => (s.meta.instrument === 'MODIS' ? SENSOR_COLOR.modis : SENSOR_COLOR.viirs);

let glowTex: CanvasTexture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new CanvasTexture(c);
  return glowTex;
}

/** Procedural low-poly spacecraft (bus + two solar wings): three boxes, no model download. */
function Model({ color }: { color: string }) {
  return (
    <>
      <mesh>
        <boxGeometry args={[0.5, 0.5, 0.8]} />
        <meshBasicMaterial color="#d9dfec" toneMapped={false} />
      </mesh>
      <mesh position={[0.95, 0, 0]}>
        <boxGeometry args={[1.3, 0.04, 0.6]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[-0.95, 0, 0]}>
        <boxGeometry args={[1.3, 0.04, 0.6]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <sprite scale={[3.4, 3.4, 1]}>
        <spriteMaterial map={glowTexture()} color={color} transparent opacity={0.55} depthWrite={false} toneMapped={false} />
      </sprite>
    </>
  );
}

function Satellite({ sat, index }: { sat: Sat; index: number }) {
  const group = useRef<Group>(null);
  const color = colorOf(sat);
  const { camera, size } = useThree();
  const tmp = useMemo(() => ({ p: new Float32Array(3), v: new Vector3(), d: new Vector3(), lastTrail: -1e15 }), []);

  const trail = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3));
    const col = new Float32Array(TRAIL_POINTS * 4);
    const c = new Color(color);
    for (let i = 0; i < TRAIL_POINTS; i++) {
      col.set([c.r, c.g, c.b, Math.pow(1 - i / (TRAIL_POINTS - 1), 1.6) * 0.85], i * 4);
    }
    g.setAttribute('color', new BufferAttribute(col, 4));
    return g;
  }, [color]);
  const trailLine = useMemo(() => {
    const l = new Line(trail, new LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
    l.frustumCulled = false;
    return l;
  }, [trail]);
  useEffect(
    () => () => {
      trail.dispose();
      trailLine.material.dispose();
    },
    [trail, trailLine],
  );

  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const now = simClock.now();
    const k = view.intro.sats;
    const ok = satScenePos(sat.rec, now, tmp.p);
    g.visible = ok && k > 0.01;
    const slot = (view.satScreen[index] ??= { norad: sat.norad, x: 0, y: 0, visible: false });
    slot.norad = sat.norad;
    if (!ok) {
      slot.visible = false;
      return;
    }
    g.position.set(tmp.p[0], tmp.p[1], tmp.p[2]);
    g.lookAt(0, 0, 0);
    g.scale.setScalar(((sat.meta.primary ? 0.03 : 0.018) / Math.sqrt(Math.max(0.6, view.zoom))) * k);

    // screen position + occlusion by the Earth, for the DOM hover card
    tmp.d.copy(g.position).sub(camera.position);
    const t = Math.min(1, Math.max(0, -camera.position.dot(tmp.d) / tmp.d.lengthSq()));
    const clear = tmp.v.copy(camera.position).addScaledVector(tmp.d, t).length() > 1.0;
    tmp.v.copy(g.position).project(camera);
    slot.x = (tmp.v.x * 0.5 + 0.5) * size.width;
    slot.y = (-tmp.v.y * 0.5 + 0.5) * size.height;
    slot.visible = clear && tmp.v.z < 1;

    // ground-frame trail of the last ~0.9 orbit; refreshed every 15 simulated seconds
    if (Math.abs(now - tmp.lastTrail) > 15_000) {
      tmp.lastTrail = now;
      const pos = trail.getAttribute('position') as BufferAttribute;
      const arr = pos.array as Float32Array;
      const step = (sat.periodMin * 60_000 * 0.9) / (TRAIL_POINTS - 1);
      for (let i = 0; i < TRAIL_POINTS; i++) {
        if (!satScenePos(sat.rec, now - i * step, arr, i * 3) && i > 0) arr.copyWithin(i * 3, (i - 1) * 3, i * 3);
      }
      pos.needsUpdate = true;
    }
  });

  const orbits = useStore((s) => s.layers.orbits);
  return (
    <>
      <group ref={group} visible={false}>
        <Model color={color} />
      </group>
      <primitive object={trailLine} visible={orbits} />
    </>
  );
}

export function Satellites() {
  const sats = useData((s) => s.sats);
  const { invalidate } = useThree();
  const orbits = useStore((s) => s.layers.orbits);
  useEffect(() => {
    view.satScreen.length = 0;
    invalidate();
  }, [sats, orbits, invalidate]);
  return (
    <>
      {sats.map((s, i) => (
        <Satellite key={s.norad} sat={s} index={i} />
      ))}
    </>
  );
}
