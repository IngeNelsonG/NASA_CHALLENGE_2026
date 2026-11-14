import { useCallback } from 'react';
import { fmtInt as fmtIntImpl, localeFor } from '@/lib/format';
import { useStore, type Lang } from '@/store';
import { en } from './locales/en';
import { es } from './locales/es';

export type Key = keyof typeof en;
const dict: Record<Lang, Record<Key, string>> = { en, es };

export function translate(lang: Lang, key: Key, vars?: Record<string, string | number>): string {
  let s = dict[lang][key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** `const t = useT()` → `t('hero.title')`, `t('cal.week_of', { date })`. English is the default. */
export function useT() {
  const lang = useStore((s) => s.lang);
  return useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

export const locale = localeFor;
export const fmtInt = fmtIntImpl;

const utc = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00Z');
export const fmtDay = (iso: string, lang: Lang) =>
  utc(iso).toLocaleDateString(locale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const fmtMonth = (iso: string, lang: Lang) =>
  utc(iso).toLocaleDateString(locale(lang), { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const monthName = (m: number, lang: Lang, style: 'short' | 'long' | 'narrow' = 'short') =>
  new Date(Date.UTC(2001, m, 1)).toLocaleDateString(locale(lang), { month: style, timeZone: 'UTC' });
