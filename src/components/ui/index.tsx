import { useEffect, useRef, useState, type ReactNode } from 'react';
import { reducedMotion } from '@/lib/capabilities';
import { SENSOR_COLOR } from '@/lib/colors';
import type { Sensor } from '@/lib/types';

/** True once the element has entered the viewport (stays true). */
export function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || typeof IntersectionObserver === 'undefined') return setInView(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${inView ? 'is-in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** Heading text whose words rise out of a mask, one after another. Screen readers get the plain text. */
export function SplitWords({ text, step = 55 }: { text: string; step?: number }) {
  const [ref, inView] = useInView<HTMLSpanElement>(0.4);
  return (
    <span ref={ref} className={`split ${inView ? 'is-in' : ''}`}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(' ').map((w, i) => (
          <span key={i} className="split-w mr-[0.24em] last:mr-0">
            <span style={{ transitionDelay: `${i * step}ms` }}>{w}</span>
          </span>
        ))}
      </span>
    </span>
  );
}

/** Label that rolls up to a copy of itself when its parent link/button is hovered. */
export function RollText({ children }: { children: ReactNode }) {
  return (
    <span className="roll">
      <span>{children}</span>
      <span aria-hidden>{children}</span>
    </span>
  );
}

/** Four-point star used as the recurring ornament. */
export function Sparkle({ className = '', spin = true }: { className?: string; spin?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={`${spin ? 'sparkle' : ''} ${className}`} fill="currentColor">
      <path d="M12 0c.5 7.2 4.8 11.5 12 12-7.2.5-11.5 4.8-12 12-.5-7.2-4.8-11.5-12-12C7.2 11.5 11.500 7.200 12 0Z" />
    </svg>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-graphite-900/70 p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`rounded-md font-semibold transition-colors duration-300 ${size === 'sm' ? 'min-h-[30px] px-2 text-xs' : 'min-h-[36px] px-3 text-sm'} ${
              on ? 'bg-cream text-coal' : 'text-ink-dim hover:bg-graphite-700 hover:text-ink'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Colour swatch + label; identity is never carried by colour alone. */
export function SensorDot({ sensor, shape = 'dot' }: { sensor: Sensor; shape?: 'dot' | 'square' | 'line' }) {
  const c = SENSOR_COLOR[sensor];
  if (shape === 'line') return <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: c }} />;
  return <span aria-hidden className={`inline-block h-2.5 w-2.5 ${shape === 'dot' ? 'rounded-full' : 'rounded-[2px]'}`} style={{ background: c }} />;
}

/** Centred section opener: small uppercase eyebrow, large serif title, optional lead. */
export function SectionHeading({ id, eyebrow, title, lead }: { id?: string; eyebrow: string; title: string; lead?: ReactNode }) {
  return (
    <header className="mx-auto mb-10 max-w-4xl text-center lg:mb-14">
      <Reveal>
        <p className="eyebrow">{eyebrow}</p>
      </Reveal>
      <h2 id={id} className="mt-5 text-[2.4rem] leading-[1.05] sm:text-5xl lg:text-6xl">
        <SplitWords text={title} />
      </h2>
      {lead && (
        <Reveal delay={180}>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-ink-dim sm:text-lg">{lead}</p>
        </Reveal>
      )}
    </header>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[32px] cursor-pointer items-center gap-2.5 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden
        className="relative h-[18px] w-8 shrink-0 rounded-full border border-line bg-graphite-900 transition-colors duration-300 after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-ink-mute after:transition-transform after:duration-300 peer-checked:border-accent peer-checked:bg-accent peer-checked:after:translate-x-3.5 peer-checked:after:bg-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-cream"
      />
      <span className="flex items-center gap-1.5">{children}</span>
    </label>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-xs text-ink-dim">
      <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      {label}
    </span>
  );
}
