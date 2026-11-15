import { create } from 'zustand';

/**
 * Display preferences: colour theme and the accessibility options. They are written as data
 * attributes on <html> (the CSS in index.css reads them) and remembered in localStorage.
 */
export type Theme = 'light' | 'dark';
export type TextSize = 'md' | 'lg' | 'xl';
type Prefs = { theme: Theme; text: TextSize; contrast: boolean; motion: boolean };

const KEY = 'prefs';
const DEFAULTS: Prefs = { theme: 'light', text: 'md', contrast: false, motion: false };

function load(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>;
    return {
      theme: p.theme === 'dark' ? 'dark' : 'light',
      text: p.text === 'lg' || p.text === 'xl' ? p.text : 'md',
      contrast: p.contrast === true,
      motion: p.motion === true,
    };
  } catch {
    return DEFAULTS;
  }
}

function apply(p: Prefs) {
  if (typeof document === 'undefined') return;
  const d = document.documentElement.dataset;
  d.theme = p.theme;
  d.text = p.text;
  d.contrast = p.contrast ? 'high' : 'normal';
  d.motion = p.motion ? 'reduce' : 'auto';
}

type State = Prefs & { setPrefs: (p: Partial<Prefs>) => void; resetA11y: () => void };

export const usePrefs = create<State>((set, get) => {
  const initial = load();
  apply(initial);
  const save = (patch: Partial<Prefs>) => {
    set(patch);
    const { theme, text, contrast, motion } = get();
    const next = { theme, text, contrast, motion };
    apply(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };
  return {
    ...initial,
    setPrefs: save,
    resetA11y: () => save({ text: 'md', contrast: false, motion: false }),
  };
});
