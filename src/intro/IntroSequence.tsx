import gsap from 'gsap';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/app/i18n';
import { reducedMotion } from '@/lib/capabilities';
import { view } from '@/scenes/view';
import { useStore } from '@/store';

const SEEN_KEY = 'intro-seen';
const seen = () => {
  try {
    return sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};
export const shouldPlayIntro = () => !seen() && !reducedMotion();

function sceneReady(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (useStore.getState().sceneReady) return resolve();
    const timer = setTimeout(done, timeoutMs);
    const unsub = useStore.subscribe((s) => s.sceneReady && done());
    function done() {
      clearTimeout(timer);
      unsub();
      resolve();
    }
  });
}

/**
 * ≈3.4 s: logo fades in (fade + uniform scale only — the brand guide forbids rotating, skewing or
 * recolouring it) → an independent ring expands like an orbit and opens a circular mask over the
 * WebGL layer → dolly-in → satellites arrive → hand over to the landing on the same canvas.
 */
export default function IntroSequence() {
  const t = useT();
  const logo = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [logoMissing, setLogoMissing] = useState(false);

  const finish = useCallback(() => {
    try {
      sessionStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* storage unavailable */
    }
    gsap.killTweensOf(view.intro);
    view.intro.dolly = 1;
    view.intro.sats = 1;
    const layer = document.getElementById('globe-layer');
    if (layer) layer.style.clipPath = 'none';
    view.kick();
    useStore.getState().set({ phase: 'landing' });
  }, []);

  useEffect(() => {
    const layer = document.getElementById('globe-layer');
    const webgl = useStore.getState().webgl;
    view.intro.dolly = 0;
    view.intro.sats = 0;
    if (layer) layer.style.clipPath = 'circle(0px at 50% 50%)';

    const R = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 24;
    const m = { r: Math.min(window.innerWidth, 520) * 0.2 };
    const apply = () => {
      if (ring.current) ring.current.style.width = ring.current.style.height = `${m.r * 2}px`;
      if (layer) layer.style.clipPath = `circle(${m.r}px at 50% 50%)`;
    };

    const tl = gsap.timeline();
    tl.fromTo(logo.current, { autoAlpha: 0, scale: 0.94 }, { autoAlpha: 1, scale: 1, duration: 0.7, ease: 'power2.out' });
    tl.to({}, { duration: 0.3 });
    tl.addPause('>', () => {
      // hold on the logo until the lazy 3D chunk and the low-res textures are in (max 2.5 s)
      void sceneReady(2500).then(() => tl.resume());
    });
    if (webgl) {
      tl.addLabel('open');
      tl.set(ring.current, { autoAlpha: 1 }, 'open');
      tl.fromTo(m, { r: m.r * 0.6 }, { r: R, duration: 1.5, ease: 'power2.inOut', onUpdate: apply }, 'open');
      tl.to(logo.current, { autoAlpha: 0, duration: 0.45, ease: 'power1.in' }, 'open+=0.2');
      tl.to(view.intro, { dolly: 1, duration: 2.0, ease: 'power2.inOut' }, 'open+=0.1');
      tl.to(view.intro, { sats: 1, duration: 0.9, ease: 'back.out(1.5)' }, 'open+=1.1');
      tl.to(ring.current, { autoAlpha: 0, duration: 0.4 }, 'open+=1.15');
      tl.call(finish, [], 'open+=2.35');
    } else {
      tl.to(logo.current, { autoAlpha: 0, duration: 0.4 });
      tl.call(finish);
    }

    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => {
      tl.kill();
      window.removeEventListener('keydown', onKey);
    };
  }, [finish]);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center" role="dialog" aria-label={t('intro.label')}>
      <div ref={ring} aria-hidden className="pointer-events-none invisible absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-brand-yonder/70 shadow-[0_0_40px_rgba(46,150,245,0.35)]" />
      <div ref={logo} className="invisible relative flex flex-col items-center px-6 text-center">
        {logoMissing ? (
          // Text stand-in until the official SVG is placed in /public/brand (we never redraw the logo).
          <p className="font-display text-2xl font-semibold tracking-wide text-ink sm:text-3xl">
            NASA Space Apps Challenge
            <span className="mt-1 block font-mono text-sm font-normal tracking-[0.3em] text-ink-dim">2026</span>
          </p>
        ) : (
          <img
            src={`${import.meta.env.BASE_URL}brand/space-apps-logo.svg`}
            alt="NASA Space Apps Challenge"
            width={280}
            height={280}
            className="h-auto w-[min(60vw,280px)]"
            onError={() => setLogoMissing(true)}
          />
        )}
      </div>
      <button type="button" onClick={finish} className="btn absolute bottom-6 right-6" autoFocus>
        {t('intro.skip')} <span aria-hidden>→</span>
      </button>
    </div>
  );
}
