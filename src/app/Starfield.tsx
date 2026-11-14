import { useEffect, useRef } from 'react';

/** Static star field on a 2D canvas: part of the first paint, no WebGL, redrawn only on resize. */
export function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      let seed = 1337;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      const n = Math.round((w * h) / 2600);
      for (let i = 0; i < n; i++) {
        const x = rnd() * w, y = rnd() * h, m = rnd();
        const r = m > 0.985 ? 1.3 : m > 0.9 ? 0.9 : 0.55;
        const tint = rnd();
        ctx.fillStyle = tint > 0.92 ? `rgba(160,200,255,${0.25 + m * 0.55})` : tint < 0.05 ? `rgba(255,214,170,${0.25 + m * 0.5})` : `rgba(255,255,255,${0.12 + m * 0.5})`;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.2832);
        ctx.fill();
      }
    };
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />;
}
