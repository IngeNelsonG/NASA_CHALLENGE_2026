import gsap from 'gsap';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '@/app/i18n';
import { useStore } from '@/store';

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

export const SECTIONS = ['hero', 'problem', 'explore', 'calendar', 'anomalies', 'method', 'analyst', 'team', 'data'] as const;
const W = 76, H = 520;

function SatIcon({ color }: { color: string }) {
  return (
    <>
      <rect x={-9} y={-2.2} width={6} height={4.4} rx={0.6} fill={color} />
      <rect x={3} y={-2.2} width={6} height={4.4} rx={0.6} fill={color} />
      <rect x={-2.6} y={-3.2} width={5.2} height={6.4} rx={1} fill="#E8EDF7" />
    </>
  );
}

/**
 * Scroll companion in the page margin: two SVG satellites ride an orbital arc tied to scroll
 * progress and the dots mark the active section. Drawn in white with mix-blend-difference so it
 * stays legible over both the cream sections and the dark windows. No WebGL involved.
 */
export function OrbitNav() {
  const t = useT();
  const section = useStore((s) => s.section);
  const pathA = useRef<SVGPathElement>(null);
  const pathB = useRef<SVGPathElement>(null);
  const satA = useRef<SVGGElement>(null);
  const satB = useRef<SVGGElement>(null);
  const [dots, setDots] = useState<{ x: number; y: number }[]>([]);

  useLayoutEffect(() => {
    const p = pathA.current;
    if (!p) return;
    const len = p.getTotalLength();
    setDots(SECTIONS.map((_, i) => p.getPointAtLength(len * (0.05 + (0.9 * i) / (SECTIONS.length - 1)))).map(({ x, y }) => ({ x, y })));
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const st = { trigger: document.documentElement, start: 'top top', end: 'bottom bottom' };
      if (pathA.current && pathB.current) {
        gsap.to(satA.current, {
          motionPath: { path: pathA.current, align: pathA.current, alignOrigin: [0.5, 0.5], autoRotate: true, start: 0.05, end: 0.95 },
          ease: 'none',
          scrollTrigger: { ...st, scrub: 0.5 },
        });
        gsap.to(satB.current, {
          motionPath: { path: pathB.current, align: pathB.current, alignOrigin: [0.5, 0.5], autoRotate: true, start: 0.0, end: 0.9 },
          ease: 'none',
          scrollTrigger: { ...st, scrub: 1.3 },
        });
      }
    });
    // Active section: looked up by id on scroll, because lazy sections replace their placeholder element.
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = window.innerHeight * 0.45;
      let cur: string = SECTIONS[0];
      for (const id of SECTIONS) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= mid) cur = id;
      }
      if (cur !== useStore.getState().section) useStore.getState().set({ section: cur });
    };
    const onScroll = () => (raf ||= requestAnimationFrame(update));
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    // sections load lazily and change height → keep trigger positions fresh
    let timer = 0;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => ScrollTrigger.refresh(), 200);
    });
    ro.observe(document.body);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      ro.disconnect();
      ctx.revert();
    };
  }, []);

  return (
    <nav aria-label={t('nav.sections')} className="fixed left-2 top-1/2 z-30 hidden -translate-y-1/2 mix-blend-difference xl:block [@media(max-height:640px)]:!hidden" style={{ width: W, height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="absolute inset-0 overflow-visible">
        <path ref={pathA} d={`M 14 10 Q 82 ${H / 2} 14 ${H - 10}`} fill="none" stroke="rgba(235,235,235,0.5)" strokeWidth={1} />
        <path ref={pathB} d={`M 26 2 Q 104 ${H / 2} 26 ${H - 2}`} fill="none" stroke="rgba(235,235,235,0.25)" strokeWidth={1} strokeDasharray="2 5" />
        <g ref={satB}>
          <SatIcon color="#cfcfcf" />
        </g>
        <g ref={satA}>
          <SatIcon color="#ffffff" />
        </g>
      </svg>
      <ol>
        {dots.map((d, i) => {
          const id = SECTIONS[i];
          const on = section === id;
          return (
            <li key={id} className="group absolute" style={{ left: d.x, top: d.y }}>
              <a
                href={`#${id}`}
                aria-current={on ? 'true' : undefined}
                className="absolute -left-3 -top-3 grid h-6 w-6 place-items-center rounded-full"
              >
                <span className={`block rounded-full transition-all ${on ? 'h-2.5 w-2.5 bg-white' : 'h-1.5 w-1.5 bg-white/50 group-hover:bg-white'}`} />
                <span className="sr-only">{t(`nav.${id}`)}</span>
              </a>
              <span
                aria-hidden
                className="data pointer-events-none absolute left-5 top-0 z-10 -translate-y-1/2 whitespace-nowrap px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
              >
                {t(`nav.${id}`)}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
