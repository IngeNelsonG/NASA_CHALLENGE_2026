import { Canvas } from '@react-three/fiber';
import { useStore } from '@/store';
import { CameraRig } from './CameraRig';
import { Atmosphere, Earth } from './Globe';
import { HexDensity, Hotspots } from './Hotspots';
import { AoiOverlay, Borders } from './Overlays';
import { Satellites } from './Satellites';

/**
 * The only WebGL renderer in the app. It is mounted once, behind the page, and is reused by the
 * intro, the hero and the explorer. Rendering is on demand (see CameraRig for the frame policy).
 * Light mode only: CSS pixel density (on a 2x screen ~3x fewer pixels than a 1.75 ratio).
 */
export default function GlobeCanvas() {
  return (
    <Canvas
      flat
      frameloop="demand"
      // the canvas never needs re-measuring on scroll (fixed, or docked and scrolling natively)
      resize={{ scroll: false }}
      dpr={1}
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
