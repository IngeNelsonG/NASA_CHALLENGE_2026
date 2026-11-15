import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { shouldPlayIntro } from '@/intro/IntroSequence';
import IntroSequence from '@/intro/IntroSequence';
import { canUse3D } from '@/lib/capabilities';
import { useStore } from '@/store';
import { DataLoaders } from './loaders';
import { onLinkClick, onMethodPage, scrollAfterSwitch, useIsMethodPage } from './route';
import { ServerStatus } from './ServerStatus';
import { Starfield } from './Starfield';

// Heavy parts are split out: the first paint is only the star field and the logo.
const GlobeCanvas = lazy(() => import('@/scenes/GlobeCanvas'));
const loadLanding = () => import('@/features/landing/Landing');
const Landing = lazy(loadLanding);
const MethodPage = lazy(() => import('@/features/methodology/MethodPage'));

export function App() {
  const phase = useStore((s) => s.phase);
  const webgl = useStore((s) => s.webgl);
  const lang = useStore((s) => s.lang);
  const method = useIsMethodPage();
  const [booted, setBooted] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    const s = useStore.getState();
    const patch: Parameters<typeof s.set>[0] = {};
    if (!canUse3D()) Object.assign(patch, { webgl: false, viewMode: '2d', sceneReady: true });
    // a direct visit to the methodology page skips the intro: it is reading material
    if (!shouldPlayIntro() || onMethodPage()) patch.phase = 'landing';
    s.set(patch);
    setBooted(true);
    void loadLanding(); // warm the landing chunk while the intro plays
    document.addEventListener('click', onLinkClick);
    return () => document.removeEventListener('click', onLinkClick);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    scrollAfterSwitch();
  }, [method]);

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
      {booted && phase === 'landing' && <Suspense fallback={null}>{method ? <MethodPage /> : <Landing />}</Suspense>}
    </>
  );
}
