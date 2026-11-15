import { useEffect, useRef, useState } from 'react';
import { useT } from '@/app/i18n';
import { Segmented } from '@/components/ui';
import { usePrefs, type TextSize } from '@/store/prefs';
import { view } from '@/scenes/view';

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="tap flex w-full items-center justify-between gap-4 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.05]"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="block text-xs leading-snug text-ink-dim">{hint}</span>
      </span>
      <span aria-hidden className={`relative h-6 w-11 shrink-0 rounded-full border border-line transition-colors ${on ? 'bg-cream' : 'bg-graphite-900'}`}>
        <span className={`absolute top-0.5 h-[1.125rem] w-[1.125rem] rounded-full transition-all ${on ? 'left-[1.375rem] bg-coal' : 'left-0.5 bg-ink-dim'}`} />
      </span>
    </button>
  );
}

/** Round accessibility button next to the help button. */
export function QuickSettings() {
  const t = useT();
  const { theme, text, contrast, motion, setPrefs, resetA11y } = usePrefs();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // the globe is drawn on demand: ask for a frame so it picks the change up
  useEffect(() => view.kick(), [theme, text, motion]);

  return (
    <div ref={wrap} className="fixed bottom-[1.375rem] right-[5.25rem] z-50 flex items-center gap-2 sm:bottom-[1.875rem] sm:right-[5.75rem]">
      {open && (
        <div
          id="a11y-panel"
          role="dialog"
          aria-label={t('a11y.title')}
          className="panel assistant-in absolute bottom-full right-0 mb-3 w-[min(20rem,calc(100vw-2rem))] !bg-graphite-800 p-3"
        >
          <p className="eyebrow px-2 pt-1">{t('a11y.title')}</p>
          <div className="mt-3 px-2">
            <p className="mb-1.5 text-sm font-semibold text-ink">{t('a11y.text')}</p>
            <Segmented<TextSize>
              size="sm"
              label={t('a11y.text')}
              value={text}
              onChange={(v) => setPrefs({ text: v })}
              options={[
                { value: 'md', label: <span className="text-xs">A</span>, title: t('a11y.text_md') },
                { value: 'lg', label: <span className="text-sm">A</span>, title: t('a11y.text_lg') },
                { value: 'xl', label: <span className="text-base">A</span>, title: t('a11y.text_xl') },
              ]}
            />
          </div>
          <div className="mt-2 space-y-0.5">
            <Toggle label={t('a11y.contrast')} hint={t('a11y.contrast_hint')} on={contrast} onChange={(v) => setPrefs({ contrast: v })} />
            <Toggle label={t('a11y.motion')} hint={t('a11y.motion_hint')} on={motion} onChange={(v) => setPrefs({ motion: v })} />
          </div>
          <button type="button" className="btn btn-sm mt-2 w-full" onClick={resetA11y}>
            {t('a11y.reset')}
          </button>
        </div>
      )}
      <button
        type="button"
        className="btn h-11 w-11 rounded-full !bg-graphite-800 !p-0 shadow-panel"
        aria-expanded={open}
        aria-controls="a11y-panel"
        aria-label={t('a11y.title')}
        title={t('a11y.title')}
        onClick={() => setOpen((v) => !v)}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="4.5" r="1.6" fill="currentColor" stroke="none" />
          <path d="M5 8.5c2.3.7 4.6 1 7 1s4.7-.3 7-1M12 9.5V14M12 14l-3 6M12 14l3 6" />
        </svg>
      </button>
    </div>
  );
}
