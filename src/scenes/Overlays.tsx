import { Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BufferAttribute, BufferGeometry, type LineSegments, type Mesh } from 'three';
import { mesh as topoMesh } from 'topojson-client';
import type { GeometryCollection } from 'topojson-specification';
import { latLonToXYZ } from '@/lib/geo';
import type { BBox } from '@/lib/types';
import { loadWorld } from '@/lib/world';
import { useStore } from '@/store';
import { view } from './view';

/** Country borders as one LineSegments draw call. */
export function Borders() {
  const visible = useStore((s) => s.layers.borders);
  const { invalidate } = useThree();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

  useEffect(() => {
    let alive = true;
    loadWorld().then((world) => {
      if (!alive) return;
      const lines = topoMesh(world, world.objects.countries as GeometryCollection);
      const pos: number[] = [];
      for (const line of lines.coordinates) {
        for (let i = 0; i < line.length - 1; i++) {
          pos.push(...latLonToXYZ(line[i][1], line[i][0], 1.0008), ...latLonToXYZ(line[i + 1][1], line[i + 1][0], 1.0008));
        }
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
      setGeometry(g);
      invalidate();
    });
    return () => {
      alive = false;
    };
  }, [invalidate]);

  useEffect(() => invalidate(), [visible, invalidate]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} visible={visible}>
      <lineBasicMaterial color="#b8c8ea" transparent opacity={0.34} depthWrite={false} />
    </lineSegments>
  );
}

function bboxRing(b: BBox, r = 1.002): [number, number, number][] {
  const pts: [number, number, number][] = [];
  const corners: [number, number][] = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]];
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = corners[i], [x1, y1] = corners[i + 1];
    const n = Math.max(2, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 1.5));
    for (let k = 0; k < n; k++) pts.push(latLonToXYZ(y0 + ((y1 - y0) * k) / n, x0 + ((x1 - x0) * k) / n, r));
  }
  pts.push(latLonToXYZ(b[1], b[0], r));
  return pts;
}

/** AOI outline, the rectangle being drawn, and the picked-point marker. */
export function AoiOverlay() {
  const bbox = useStore((s) => s.aoi.bbox);
  const picked = useStore((s) => s.picked);
  const { invalidate } = useThree();
  const points = useMemo(() => bboxRing(bbox), [bbox]);
  const marker = useRef<Mesh>(null);
  const draft = useRef<LineSegments>(null);
  const draftKey = useRef('');

  useEffect(() => invalidate(), [bbox, picked, invalidate]);

  useEffect(() => {
    if (!marker.current || !picked) return;
    marker.current.position.set(...latLonToXYZ(picked.lat, picked.lon, 1.003));
    marker.current.lookAt(0, 0, 0);
  }, [picked]);

  useFrame(() => {
    const line = draft.current;
    if (!line) return;
    const key = view.draft ? view.draft.join() : '';
    if (key === draftKey.current) return;
    draftKey.current = key;
    line.visible = !!view.draft;
    if (view.draft) {
      const ring = bboxRing(view.draft, 1.0025);
      const arr: number[] = [];
      for (let i = 0; i < ring.length - 1; i++) arr.push(...ring[i], ...ring[i + 1]);
      line.geometry.dispose();
      line.geometry = new BufferGeometry();
      line.geometry.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    }
  });

  return (
    <>
      <Line points={points} color="#EAFE07" lineWidth={1.6} transparent opacity={0.9} depthWrite={false} />
      <lineSegments ref={draft} visible={false}>
        <bufferGeometry />
        <lineBasicMaterial color="#ffffff" transparent opacity={0.9} depthTest={false} />
      </lineSegments>
      <mesh ref={marker} visible={!!picked}>
        <ringGeometry args={[0.006, 0.0085, 32]} />
        <meshBasicMaterial color="#ffffff" side={2} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
      </mesh>
    </>
  );
}
