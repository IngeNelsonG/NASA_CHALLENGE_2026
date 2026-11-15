import { lazy, Suspense, useEffect, useState } from 'react';
import { shouldPlayIntro } from '@/intro/IntroSequence';
import IntroSequence from '@/intro/IntroSequence';
import { canUse3D } from '@/lib/capabilities';
import { useStore } from '@/store';
import { DataLoaders } from './loaders';
import { ServerStatus } from './ServerStatus';
import { Starfield } from './Starfield';

// Heavy parts are split out: the first paint is only the star field and the logo.
const GlobeCanvas = lazy(() => import('@/scenes/GlobeCanvas'));
const loadLanding = () => import('@/features/landing/Landing');
const Landing = lazy(loadLanding);

export function App() {
  const phase = useStore((s) => s.phase);
  const webgl = useStore((s) => s.webgl);
  const lang = useStore((s) => s.lang);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    const s = useStore.getState();
    const patch: Parameters<typeof s.set>[0] = {};
    if (!canUse3D()) Object.assign(patch, { webgl: false, viewMode: '2d', sceneReady: true });
    if (!shouldPlayIntro()) patch.phase = 'landing';
    s.set(patch);
    setBooted(true);
    void loadLanding(); // warm the landing chunk while the intro plays
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <>
      <Starfield />
      <div id="globe-layer" aria-hidden className="pointer-events-none fixed inset-0 z-0" style={{ opacity: 0 }}>
        {booted && webgl && (
          <Suspense fallback={null}>
            <GlobeCanvas />
          </Suspense>
        )}
      </div>
      {booted && <DataLoaders />}
      {booted && <ServerStatus />}
      {booted && phase === 'intro' && <IntroSequence />}
      {booted && phase === 'landing' && (
        <Suspense fallback={null}>
          <Landing />
        </Suspense>
      )}
    </>
  );
}
