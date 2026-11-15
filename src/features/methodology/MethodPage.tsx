import { useT } from '@/app/i18n';
import { Sparkle } from '@/components/ui';
import { Assistant } from '@/features/assistant/Assistant';
import { Footer } from '@/features/landing/Footer';
import { Header } from '@/features/landing/Header';
import { QuickSettings } from '@/features/landing/QuickSettings';
import { Transparency } from '@/features/transparency/Transparency';
import { Methodology } from './Methodology';

const TOC = [
  { href: '#method', label: 'mpage.i1_t' },
  { href: '#transparency', label: 'nav.transparency' },
  { href: '#transparency-method', label: 'mpage.toc_formulas' },
] as const;

/** `/metodologia`: how Ember works, apart from the explorer so neither page gets crowded. */
export default function MethodPage() {
  const t = useT();
  return (
    <div className="fade-opacity relative z-10 overflow-x-clip">
      <a href="#main" className="btn btn-primary fixed left-3 top-3 z-50 -translate-y-20 focus:translate-y-0">
        {t('nav.skip')}
      </a>
      <Header />
      <main id="main">
        <section className="frame" aria-labelledby="mpage-title">
          <div className="window relative overflow-hidden px-5 pb-12 pt-28 sm:px-8 lg:px-12 lg:pb-16 lg:pt-36 xl:pl-24">
            <span aria-hidden className="pointer-events-none absolute -right-16 top-16 h-72 w-72 opacity-[0.07]">
              <Sparkle className="h-full w-full text-cream" />
            </span>
            <a href="/#explore" className="tap fade-in inline-flex items-center gap-2 text-sm text-ink-dim transition-colors hover:text-ink">
              <span aria-hidden>←</span>
              {t('mpage.back')}
            </a>
            <p className="eyebrow fade-in mt-8" style={{ animationDelay: '0.1s' }}>
              {t('mpage.eyebrow')}
            </p>
            <h1
              id="mpage-title"
              className="fade-in mt-4 max-w-4xl font-display text-[clamp(2.6rem,7vw,5.5rem)] font-light leading-[1] text-cream"
              style={{ animationDelay: '0.2s', textWrap: 'balance' }}
            >
              {t('mpage.title')}
            </h1>
            <p className="fade-in mt-6 max-w-2xl text-base leading-relaxed text-ink-dim sm:text-lg" style={{ animationDelay: '0.3s' }}>
              {t('mpage.lead')}
            </p>
            <nav aria-label={t('mpage.toc')} className="fade-in mt-10" style={{ animationDelay: '0.4s' }}>
              <p className="text-xs uppercase tracking-[0.18em] text-ink-mute">{t('mpage.toc')}</p>
              <ol className="mt-3 flex flex-wrap gap-2">
                {TOC.map((it, i) => (
                  <li key={it.href}>
                    <a href={it.href} className="chip-btn">
                      <span className="data text-ink-mute">{String(i + 1).padStart(2, '0')}</span>
                      {t(it.label)}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </section>
        <Methodology />
        <Transparency />
      </main>
      <Footer />
      <QuickSettings />
      <Assistant />
    </div>
  );
}
