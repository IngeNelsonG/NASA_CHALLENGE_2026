import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { BackSide, AdditiveBlending, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader, Vector3 } from 'three';
import { isMobile } from '@/lib/capabilities';
import { latLonToXYZ, subsolar } from '@/lib/geo';
import { simClock } from '@/lib/simClock';
import { useStore } from '@/store';

const sun = new Vector3(1, 0, 0);
/** Sun direction in the Earth-fixed scene frame, shared by Earth and Atmosphere. */
export const sunUniform = { value: sun };

const VERT = /* glsl */ `
  varying vec2 vUv; varying vec3 vN; varying vec3 vNv; varying vec3 vView;
  void main() {
    vUv = uv;
    vN = normalize(position);
    vNv = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D uDay; uniform sampler2D uNight; uniform vec3 uSun; uniform float uTerminator;
  varying vec2 vUv; varying vec3 vN; varying vec3 vNv; varying vec3 vView;
  void main() {
    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;
    float nd = dot(vN, uSun);
    float lit = mix(1.0, smoothstep(-0.10, 0.20, nd), uTerminator);
    vec3 dayCol = day * (0.74 + 0.22 * max(nd, 0.0) * uTerminator);
    vec3 nightCol = day * vec3(0.045, 0.06, 0.11) + night * vec3(1.0, 0.80, 0.52) * 1.25;
    vec3 col = mix(nightCol, dayCol, lit);
    float fres = pow(1.0 - max(dot(vNv, vView), 0.0), 3.0);
    col += vec3(0.16, 0.42, 1.0) * fres * 0.5 * (0.3 + 0.7 * lit);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const ATMO_FRAG = /* glsl */ `
  uniform vec3 uSun;
  varying vec3 vN; varying vec3 vNv;
  void main() {
    float c = clamp(-vNv.z / 0.5, 0.0, 1.0);
    float glow = pow(c, 2.6);
    float sunSide = 0.35 + 0.65 * smoothstep(-0.35, 0.45, dot(vN, uSun));
    gl_FragColor = vec4(vec3(0.20, 0.50, 1.0) * glow * sunSide, glow * sunSide);
    #include <colorspace_fragment>
  }`;

export function Earth() {
  const { gl, invalidate } = useThree();
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: EARTH_FRAG,
        uniforms: { uDay: { value: null as Texture | null }, uNight: { value: null as Texture | null }, uSun: sunUniform, uTerminator: { value: 1 } },
      }),
    [],
  );

  // Progressive textures: 512 px first (≈12 KB for both), then 2K on mobile / 4K on desktop.
  useEffect(() => {
    let alive = true;
    const loader = new TextureLoader();
    const big = !isMobile() && gl.capabilities.maxTextureSize >= 4096 ? 4096 : 2048;
    const load = (name: 'day' | 'night', res: number) =>
      loader.loadAsync(`${import.meta.env.BASE_URL}textures/earth-${name}-${res}.webp`).then((t) => {
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        return t;
      });
    const apply = (key: 'uDay' | 'uNight', t: Texture) => {
      if (!alive) return t.dispose();
      (material.uniforms[key].value as Texture | null)?.dispose();
      material.uniforms[key].value = t;
      invalidate();
    };
    Promise.all([load('day', 512), load('night', 512)])
      .then(([d, n]) => {
        apply('uDay', d);
        apply('uNight', n);
        useStore.getState().set({ sceneReady: true });
        return Promise.all([load('day', big).then((t) => apply('uDay', t)), load('night', big).then((t) => apply('uNight', t))]);
      })
      .catch(() => useStore.getState().set({ sceneReady: true }));
    return () => {
      alive = false;
    };
  }, [gl, invalidate, material]);

  useFrame(() => {
    const p = subsolar(simClock.now());
    const [x, y, z] = latLonToXYZ(p.lat, p.lon);
    sun.set(x, y, z);
    const target = useStore.getState().layers.terminator ? 1 : 0;
    const u = material.uniforms.uTerminator;
    if (u.value !== target) {
      u.value += Math.sign(target - u.value) * Math.min(Math.abs(target - u.value), 0.08);
      invalidate();
    }
  });

  return (
    <mesh material={material}>
      <sphereGeometry args={[1, 96, 64]} />
    </mesh>
  );
}

export function Atmosphere() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: ATMO_FRAG,
        uniforms: { uSun: sunUniform },
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [],
  );
  return (
    <mesh material={material}>
      <sphereGeometry args={[1.16, 64, 48]} />
    </mesh>
  );
}
