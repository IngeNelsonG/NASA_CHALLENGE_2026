import { useEffect, useState } from 'react';
import { useT } from '@/app/i18n';
import { RollText, Sparkle } from '@/components/ui';
import { APP_NAME, USE_MOCKS } from '@/lib/env';
import { useStore } from '@/store';
import { SECTIONS } from './OrbitNav';

const LINKS = SECTIONS.slice(1);

/**
 * Top navigation. It sits at the top of the page and scrolls away with it: on wide screens the
 * orbit rail (OrbitNav) takes over; below `xl`, where there is no rail, a round menu button stays
 * in the corner once the header is gone. Desktop links roll on hover; small screens use a
 * full-screen menu.
 */
export function Header() {
  const t = useT();
  const lang = useStore((s) => s.lang);
  const section = useStore((s) => s.section);
  const setLang = useStore((s) => s.setLang);
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 120);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onResize = () => window.innerWidth >= 1280 && setOpen(false);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return (
    <>
      <header
        className={`absolute inset-x-3 top-3 z-50 mx-auto max-w-[1400px] rounded-2xl border transition-[background-color,border-color] duration-300 sm:inset-x-5 sm:top-5 lg:inset-x-8 lg:top-7 ${
          open ? 'border-line bg-graphite-950/95' : 'border-transparent bg-transparent'
        }`}
      >
        <div className="flex h-14 items-center gap-3 px-4 lg:gap-5 lg:px-6">
          <a href="#hero" onClick={() => setOpen(false)} className="tap flex items-center gap-2 whitespace-nowrap font-display text-lg tracking-wide text-ink">
            <Sparkle className="h-3.5 w-3.5 text-accent" />
            {APP_NAME}
          </a>
          {USE_MOCKS && (
            <span className="chip hidden border-harmonized/60 text-ink sm:inline-flex" title={t('header.mock_title')}>
              {t('header.mock')}
            </span>
          )}
          <span aria-hidden className="hidden h-5 w-px bg-line lg:block" />
          <nav aria-label={t('nav.label')} className="hidden items-center gap-x-5 lg:flex">
            {LINKS.map((id) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={section === id ? 'true' : undefined}
                className={`py-2 text-[1.0625rem] transition-colors duration-300 ${section === id ? 'text-ink' : 'text-ink-dim hover:text-ink'}`}
              >
                <RollText>{t(`nav.${id}`)}</RollText>
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
              aria-label={t('header.lang')}
              lang={lang === 'en' ? 'es' : 'en'}
            >
              {lang === 'en' ? 'ES' : 'EN'}
            </button>
            <a href="#explore" className="btn btn-primary btn-sm hidden !px-5 xl:inline-flex">
              <RollText>{t('hero.cta')}</RollText>
              <span aria-hidden className="btn-plus">+</span>
            </a>
            <button
              type="button"
              className="btn btn-icon lg:hidden"
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={t(open ? 'header.menu_close' : 'header.menu_open')}
              onClick={() => setOpen((v) => !v)}
            >
              <span aria-hidden className="relative block h-3 w-4">
                <span className={`absolute left-0 h-0.5 w-4 rounded bg-current transition-transform duration-300 ${open ? 'top-1.5 rotate-45' : 'top-0'}`} />
                <span className={`absolute left-0 top-1.5 h-0.5 w-4 rounded bg-current transition-opacity duration-200 ${open ? 'opacity-0' : ''}`} />
                <span className={`absolute left-0 h-0.5 w-4 rounded bg-current transition-transform duration-300 ${open ? 'top-1.5 -rotate-45' : 'top-3'}`} />
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* below xl there is no orbit rail: keep a way back to the menu once the header has scrolled away */}
      <button
        type="button"
        className={`btn btn-icon fixed right-3 top-3 z-50 rounded-full bg-graphite-950/90 shadow-panel backdrop-blur-md transition-[opacity,transform] duration-300 sm:right-5 sm:top-5 xl:hidden ${
          scrolled ? 'opacity-100' : 'pointer-events-none -translate-y-3 opacity-0'
        }`}
        aria-hidden={!scrolled}
        tabIndex={scrolled ? 0 : -1}
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={t(open ? 'header.menu_close' : 'header.menu_open')}
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden className="relative block h-3 w-4">
          <span className={`absolute left-0 h-0.5 w-4 rounded bg-current transition-transform duration-300 ${open ? 'top-1.5 rotate-45' : 'top-0'}`} />
          <span className={`absolute left-0 top-1.5 h-0.5 w-4 rounded bg-current transition-opacity duration-200 ${open ? 'opacity-0' : ''}`} />
          <span className={`absolute left-0 h-0.5 w-4 rounded bg-current transition-transform duration-300 ${open ? 'top-1.5 -rotate-45' : 'top-3'}`} />
        </span>
      </button>

      {open && (
        <div id="mobile-menu" className="menu-in fixed inset-0 z-40 overflow-y-auto bg-graphite-950 px-6 pb-10 pt-28 xl:hidden">
          <nav aria-label={t('nav.label')}>
            <ol className="flex flex-col">
              {LINKS.map((id, i) => (
                <li key={id} style={{ animationDelay: `${60 + i * 45}ms` }} className="border-b border-line">
                  <a
                    href={`#${id}`}
                    onClick={() => setOpen(false)}
                    aria-current={section === id ? 'true' : undefined}
                    className="flex items-baseline justify-between py-3.5 font-display text-3xl text-ink"
                  >
                    {t(`nav.${id}`)}
                    <span className="data text-xs text-ink-mute">{String(i + 1).padStart(2, '0')}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      )}
    </>
  );
}
