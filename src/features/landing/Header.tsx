import { useT } from '@/app/i18n';
import { APP_NAME, USE_MOCKS } from '@/lib/env';
import { useStore } from '@/store';
import { SECTIONS } from './OrbitNav';

export function Header() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const section = useStore((s) => s.section);
  const setLang = useStore((s) => s.setLang);
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-line bg-space-950/75 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <a href="#hero" className="flex items-center gap-2 font-display text-base font-extrabold tracking-wide text-ink">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full bg-modis shadow-[0_0_12px_rgba(245,124,46,0.9)]" />
          {APP_NAME}
        </a>
        {USE_MOCKS && (
          <span className="chip border-harmonized/60 text-ink" title={t('header.mock_title')}>
            {t('header.mock')}
          </span>
        )}
        <nav aria-label={t('nav.label')} className="ml-auto hidden items-center gap-0.5 lg:flex xl:hidden">
          {SECTIONS.slice(1).map((id) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={section === id ? 'true' : undefined}
              className={`rounded-md px-2.5 py-1.5 text-sm ${section === id ? 'bg-space-700 text-ink' : 'text-ink-dim hover:text-ink'}`}
            >
              {t(`nav.${id}`)}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className="btn ml-auto !min-h-[36px] font-mono lg:ml-2 xl:ml-auto"
          onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
          aria-label={t('header.lang')}
          lang={lang === 'en' ? 'es' : 'en'}
        >
          {lang === 'en' ? 'ES' : 'EN'}
        </button>
      </div>
    </header>
  );
}
