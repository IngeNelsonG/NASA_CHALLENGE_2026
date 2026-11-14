import { Canvas } from '@react-three/fiber';
import { isMobile } from '@/lib/capabilities';
import { useStore } from '@/store';
import { CameraRig } from './CameraRig';
import { Atmosphere, Earth } from './Globe';
import { HexDensity, Hotspots } from './Hotspots';
import { AoiOverlay, Borders } from './Overlays';
import { Satellites } from './Satellites';

/**
 * The only WebGL renderer in the app. It is mounted once, behind the page, and is reused by the
 * intro, the hero and the explorer. Rendering is on demand (see CameraRig for the frame policy).
 */
export default function GlobeCanvas() {
  return (
    <Canvas
      flat
      frameloop="demand"
      dpr={isMobile() ? [1, 1.5] : [1, 1.75]}
      gl={{ antialias: typeof window === 'undefined' || window.devicePixelRatio < 2, alpha: true, powerPreference: 'high-performance', stencil: false }}
      camera={{ fov: 30, near: 0.1, far: 20, position: [0, 0, 6] }}
      style={{ pointerEvents: 'none' }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          useStore.getState().set({ viewMode: '2d' });
        });
      }}
    >
      <CameraRig />
      <Earth />
      <Atmosphere />
      <Borders />
      <HexDensity />
      <Hotspots />
      <AoiOverlay />
      <Satellites />
    </Canvas>
  );
}
