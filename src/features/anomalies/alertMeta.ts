import type { AlertAssessment, AOI, EnsoPhase, EnsoResponse } from '@/lib/types';

export type SeverityStyle = {
  dot: string;
  symbol: string;
  border: string;
};

const SEVERITY_STYLES: Record<AlertAssessment['severity'], SeverityStyle> = {
  CRITICAL: { dot: 'bg-sev-critical', symbol: '■', border: 'border-sev-critical/50' },
  WARNING: { dot: 'bg-sev-warning', symbol: '▲', border: 'border-sev-warning/50' },
  WATCH: { dot: 'bg-sev-watch', symbol: '◆', border: 'border-sev-watch/50' },
  NORMAL: { dot: 'bg-sev-normal', symbol: '●', border: 'border-sev-normal/40' },
};

const NON_ENSO_TOKENS = new Set([
  'japan',
  'japon',
  'jp',
  'korea',
  'south korea',
  'north korea',
  'corea',
  'kr',
  'kp',
  'china',
  'cn',
  'russia',
  'rusia',
  'ru',
  'canada',
  'ca',
  'europe',
  'europa',
  'united kingdom',
  'reino unido',
  'uk',
  'gb',
  'ireland',
  'irlanda',
  'ie',
  'france',
  'francia',
  'fr',
  'spain',
  'espana',
  'es',
  'portugal',
  'pt',
  'italy',
  'italia',
  'it',
  'germany',
  'alemania',
  'de',
  'poland',
  'polonia',
  'pl',
  'ukraine',
  'ucrania',
  'ua',
  'greece',
  'grecia',
  'gr',
  'turkey',
  'turquia',
  'tr',
  'sweden',
  'suecia',
  'se',
  'norway',
  'noruega',
  'no',
  'finland',
  'finlandia',
  'fi',
  'romania',
  'rumania',
  'ro',
  'bulgaria',
  'bg',
  'croatia',
  'croacia',
  'hr',
  'austria',
  'at',
  'switzerland',
  'suiza',
  'ch',
  'belgium',
  'belgica',
  'be',
  'netherlands',
  'paises bajos',
  'nl',
  'denmark',
  'dinamarca',
  'dk',
  'czechia',
  'czech republic',
  'chequia',
  'hungary',
  'hungria',
  'hu',
  'serbia',
  'rs',
  'bosnia',
  'albania',
  'belarus',
  'bielorrusia',
  'lithuania',
  'lituania',
  'latvia',
  'letonia',
  'estonia',
  'iceland',
  'islandia',
  'morocco',
  'marruecos',
  'algeria',
  'argelia',
  'tunisia',
  'tunez',
  'libya',
  'libia',
  'egypt',
  'egipto',
  'iran',
  'iraq',
  'syria',
  'kazakhstan',
  'kazajistan',
  'mongolia',
]);

const HIGH_LAT_ENSO_ALLOW = ['australia', 'chile', 'argentina', 'uruguay', 'new zealand', 'nueva zelanda', 'united states', 'estados unidos'];

function normText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^country:/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

/**
 * Deterministic check of whether Pacific El Niño / La Niña teleconnections apply to an AOI.
 * Rejects extra-tropical / Eurasian / European / Japanese territories synchronously so UI never
 * flashes ENSO charts before backend responses arrive.
 */
export function isEnsoRelevantAoi(
  aoi: Pick<AOI, 'id' | 'name' | 'bbox'>,
  alert?: Pick<AlertAssessment, 'enso_relevant'> | null,
  enso?: Pick<EnsoResponse, 'relevant'> | null,
): boolean {
  if (alert?.enso_relevant === false || enso?.relevant === false) return false;
  if (aoi.id === 'world') return true;

  const idNorm = normText(aoi.id);
  const nameNorm = normText(aoi.name);
  if (NON_ENSO_TOKENS.has(idNorm) || NON_ENSO_TOKENS.has(nameNorm)) return false;
  for (const tok of NON_ENSO_TOKENS) {
    if (tok.length > 2) {
      const re = new RegExp(`\\b${tok}\\b`);
      if (re.test(nameNorm) || re.test(idNorm)) return false;
    }
  }

  const [west, south, east, north] = aoi.bbox;
  const latMid = (south + north) / 2;
  const lonMid = (west + east) / 2;
  const allowHighLat =
    idNorm === 'ar' ||
    HIGH_LAT_ENSO_ALLOW.some((k) => nameNorm.includes(k) || idNorm.includes(k));

  if (Math.abs(latMid) > 30 && !allowHighLat) return false;
  if (lonMid >= -20 && lonMid <= 60 && latMid >= 20) return false;
  return true;
}

/** Consistent severity dot, shape marker (colorblind-safe), and border classes. */
export function severityStyle(sev: AlertAssessment['severity']): SeverityStyle {
  return SEVERITY_STYLES[sev] ?? SEVERITY_STYLES.NORMAL;
}

export function ensoDotClass(phase: EnsoPhase): string {
  if (phase === 'EL_NINO') return 'bg-accent';
  if (phase === 'LA_NINA') return 'bg-viirs';
  return 'bg-ink-mute';
}
