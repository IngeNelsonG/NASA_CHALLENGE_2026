import type { Lang } from '@/store';

const cache = new Map<string, Intl.NumberFormat>();

export const localeFor = (lang: Lang): string => (lang === 'es' ? 'es-CO' : 'en-GB');

function getFormatter(lang: Lang, decimals: number): Intl.NumberFormat {
  const loc = localeFor(lang);
  const key = `${loc}:${decimals}`;
  let nf = cache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat(loc, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    cache.set(key, nf);
  }
  return nf;
}

/** Single locale-aware number formatter using true minus sign (−) and current UI language. */
export function fmtNumber(value: number, lang: Lang, decimals = 0, signed = false): string {
  if (!Number.isFinite(value)) return '—';
  const threshold = 0.5 * Math.pow(10, -decimals);
  const isZero = Math.abs(value) < threshold;
  const formatted = getFormatter(lang, decimals).format(isZero ? 0 : Math.abs(value));
  if (isZero) return formatted;
  if (value < 0) return `−${formatted}`;
  return signed ? `+${formatted}` : formatted;
}

export const fmtInt = (value: number, lang: Lang): string => fmtNumber(Math.round(value), lang, 0, false);

export const fmtDec = (value: number, lang: Lang, decimals = 2): string => fmtNumber(value, lang, decimals, false);

export const fmtSigned = (value: number, lang: Lang, decimals = 2): string => fmtNumber(value, lang, decimals, true);

export const fmtSigma = (value: number, lang: Lang, decimals = 2): string => `${fmtNumber(value, lang, decimals, true)} σ`;

export const fmtRatio = (value: number, lang: Lang, decimals = 2): string => `${fmtNumber(value, lang, decimals, false)}×`;

export const fmtTempC = (value: number, lang: Lang, decimals = 2): string => `${fmtNumber(value, lang, decimals, true)} °C`;

export const fmtPercent = (value: number, lang: Lang, decimals = 0): string => `${fmtNumber(value, lang, decimals, false)} %`;
