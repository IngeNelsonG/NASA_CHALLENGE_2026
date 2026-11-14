import type { ReactNode } from 'react';
import { SENSOR_COLOR } from '@/lib/colors';
import type { Sensor } from '@/lib/types';

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
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-space-900/70 p-0.5">
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
            className={`rounded-md font-semibold transition-colors ${size === 'sm' ? 'min-h-[30px] px-2 text-xs' : 'min-h-[36px] px-3 text-sm'} ${
              on ? 'bg-brand-neon text-white' : 'text-ink-dim hover:bg-space-700 hover:text-ink'
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

export function SectionHeading({ id, eyebrow, title, lead }: { id?: string; eyebrow: string; title: string; lead?: ReactNode }) {
  return (
    <header className="mb-8 max-w-3xl">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{title}</h2>
      {lead && <p className="mt-3 text-base leading-relaxed text-ink-dim sm:text-lg">{lead}</p>}
    </header>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex min-h-[32px] cursor-pointer items-center gap-2.5 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden
        className="relative h-[18px] w-8 shrink-0 rounded-full border border-line bg-space-900 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-3 after:w-3 after:rounded-full after:bg-ink-mute after:transition-transform peer-checked:border-brand-yonder peer-checked:bg-brand-neon peer-checked:after:translate-x-3.5 peer-checked:after:bg-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-yellow"
      />
      <span className="flex items-center gap-1.5">{children}</span>
    </label>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-xs text-ink-dim">
      <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-brand-yonder border-t-transparent" />
      {label}
    </span>
  );
}
