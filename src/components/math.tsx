import type { ReactNode } from 'react';

/**
 * Tiny typesetting kit for the formulas of the methodology and transparency sections: italic
 * serif variables, stacked fractions, sub/superscripts. No math library needed for a dozen
 * equations, and the text stays selectable and readable by screen readers (`aria-label`).
 */

/** Variable (italic serif). */
export const V = ({ children }: { children: ReactNode }) => <i className="font-display italic">{children}</i>;

/** Upright function or word inside a formula (ln, max, median…). */
export const Fn = ({ children }: { children: ReactNode }) => <span className="font-sans not-italic">{children}</span>;

export const Sub = ({ children }: { children: ReactNode }) => (
  <sub className="relative -bottom-[0.1em] text-[0.66em] not-italic leading-none">{children}</sub>
);
export const Sup = ({ children }: { children: ReactNode }) => <sup className="text-[0.66em] not-italic leading-none">{children}</sup>;

/** Operator with breathing room on both sides. */
export const Op = ({ children }: { children: ReactNode }) => <span className="mx-[0.32em] font-sans not-italic text-ink-dim">{children}</span>;

/** Stacked fraction, centred on the maths axis. */
export function Frac({ n, d }: { n: ReactNode; d: ReactNode }) {
  return (
    <span className="mx-[0.15em] inline-flex flex-col items-center text-center align-middle text-[0.9em] leading-[1.35]">
      <span className="px-[0.3em]">{n}</span>
      <span className="w-full border-t border-current px-[0.3em] pt-[0.1em]">{d}</span>
    </span>
  );
}

/** Parenthesised group whose brackets grow with a fraction inside. */
export const Paren = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center">
    <span className="font-sans text-[1.35em] font-extralight leading-none text-ink-dim">(</span>
    {children}
    <span className="font-sans text-[1.35em] font-extralight leading-none text-ink-dim">)</span>
  </span>
);

/** A displayed formula: dark block, centred, scrolls sideways rather than wrapping on phones. */
export function Formula({ label, caption, children }: { label: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <figure className="min-w-0">
      <div
        role="math"
        aria-label={label}
        className="overflow-x-auto rounded-xl border border-white/10 bg-graphite-950/70 px-4 py-4 text-center [scrollbar-width:thin]"
      >
        <span className="inline-block whitespace-nowrap font-display text-[1.05rem] leading-relaxed text-cream sm:text-lg">{children}</span>
      </div>
      {caption && <figcaption className="mt-2 text-xs leading-relaxed text-ink-mute">{caption}</figcaption>}
    </figure>
  );
}
