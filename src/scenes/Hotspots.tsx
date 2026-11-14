import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, CircleGeometry, Color, type InstancedMesh, Matrix4, ShaderMaterial, Sphere, SRGBColorSpace, Vector3 } from 'three';
import { fireRGB, HOTSPOT_COLOR } from '@/lib/colors';
import { DEG, latLonToXYZ } from '@/lib/geo';
import { useStore } from '@/store';
import { useData } from '@/store/data';
import { view } from './view';

const VERT = /* glsl */ `
  attribute float aFrp;
  uniform float uSize; uniform vec3 uCol;
  varying vec3 vCol; varying float vVis;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vec3 n = normalize(position);
    // horizon test instead of depth: points on the far side fade out at the limb
    vVis = smoothstep(0.02, 0.10, dot(n, normalize(cameraPosition - position)));
    // MODIS pixels (1 km) are drawn larger than VIIRS pixels (375 m)
    gl_PointSize = uSize * 0.8 * (0.85 + 0.3 * clamp(log(aFrp + 1.0) / 5.0, 0.0, 1.0));
    vCol = uCol;
    if (vVis < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;
const FRAG = /* glsl */ `
  varying vec3 vCol; varying float vVis;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.36, d) * vVis;
    if (a < 0.02) discard;
    vec3 col = mix(vCol, vec3(1.0), smoothstep(0.22, 0.0, d) * 0.35);
    gl_FragColor = vec4(col, a * 0.88);
    #include <colorspace_fragment>
  }`;

/** All fire detections in one colour and one draw call: MODIS and VIIRS are shown as a single unified record. */
export function Hotspots() {
  const data = useData((s) => s.hotspots);
  const { gl, invalidate } = useThree();

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uSize: { value: 6 },
          uCol: { value: new Color(HOTSPOT_COLOR) },
        },
      }),
    [],
  );

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    if (data) {
      g.setAttribute('position', new BufferAttribute(data.xyz, 3));
      g.setAttribute('aFrp', new BufferAttribute(data.frp, 1));
    }
    g.boundingSphere = new Sphere(new Vector3(), 1.1);
    return g;
  }, [data]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => invalidate(), [geometry, invalidate]);

  useFrame(() => {
    material.uniforms.uSize.value = gl.getPixelRatio() * Math.min(16, 3.4 * Math.pow(Math.max(0.5, view.zoom), 0.75) + 1.2);
  });

  if (!data || data.count === 0) return null;
  return <points geometry={geometry} material={material} frustumCulled={false} renderOrder={3} />;
}

const MAX_HEX = 8000;

/** Sensor-balanced relative density as instanced hexagons lying on the sphere. */
export function HexDensity() {
  const data = useData((s) => s.hotspots);
  const visible = useStore((s) => s.layers.density);
  const ref = useRef<InstancedMesh>(null);
  const { invalidate } = useThree();
  const geometry = useMemo(() => new CircleGeometry(1, 6), []);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const hex = data?.hex;
    const n = hex ? Math.min(MAX_HEX, hex.length / 3) : 0;
    const m = new Matrix4();
    const up = new Vector3(), east = new Vector3(), north = new Vector3(), pos = new Vector3();
    const c = new Color();
    const R = (data?.hexRadiusDeg ?? 0.1) * DEG * 0.94;
    for (let i = 0; i < n; i++) {
      const lon = hex![i * 3], lat = hex![i * 3 + 1], v = hex![i * 3 + 2];
      up.set(...latLonToXYZ(lat, lon));
      east.set(-Math.sin(lon * DEG), 0, -Math.cos(lon * DEG));
      north.crossVectors(up, east);
      pos.copy(up).multiplyScalar(1.0011);
      m.makeBasis(east.clone().multiplyScalar(R), north.clone().multiplyScalar(R), up);
      m.setPosition(pos);
      mesh.setMatrixAt(i, m);
      const [r, g, b] = fireRGB(Math.sqrt(v));
      mesh.setColorAt(i, c.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace));
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [data, visible, invalidate]);

  return (
    <instancedMesh ref={ref} args={[geometry, undefined, MAX_HEX]} visible={visible} frustumCulled={false} renderOrder={2}>
      <meshBasicMaterial transparent opacity={0.82} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}
