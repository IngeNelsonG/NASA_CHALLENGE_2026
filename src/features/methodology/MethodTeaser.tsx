import { useT, type Key } from '@/app/i18n';
import { METHOD_PATH } from '@/app/route';
import { Formula, Frac, Op, Sub, V } from '@/components/math';
import { Reveal, RollText, Sparkle } from '@/components/ui';

const ITEMS: { n: string; title: Key; body: Key }[] = [
  { n: '01', title: 'mpage.i1_t', body: 'mpage.i1_b' },
  { n: '02', title: 'mpage.i2_t', body: 'mpage.i2_b' },
  { n: '03', title: 'mpage.i3_t', body: 'mpage.i3_b' },
];

const w = (s: string) => (
  <>
    <V>w</V>
    <Sub>{s}</Sub>
  </>
);

/** Landing stand-in for the methodology and transparency sections, which now live on their own page. */
export function MethodTeaser() {
  const t = useT();
  return (
    <section id="method" className="section" aria-labelledby="method-teaser-title">
      <Reveal>
        <div className="panel relative grid gap-10 overflow-hidden p-6 sm:p-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16 lg:p-14">
          <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 opacity-[0.07]">
            <Sparkle className="h-full w-full text-cream" />
          </span>
          <div className="flex flex-col items-start">
            <p className="eyebrow">{t('mpage.eyebrow')}</p>
            <h2 id="method-teaser-title" className="mt-5 text-[2.2rem] leading-[1.05] text-cream sm:text-5xl" style={{ textWrap: 'balance' }}>
              {t('mpage.teaser_title')}
            </h2>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-dim sm:text-lg">{t('mpage.teaser_lead')}</p>
            <a href={METHOD_PATH} className="btn btn-primary mt-8 !px-6">
              <RollText>{t('mpage.cta')}</RollText>
              <span aria-hidden className="btn-plus">+</span>
            </a>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Formula label="H = (w_M M + w_V V/k) / (w_M + w_V)" caption={t('mpage.formula_caption')}>
              <V>H</V>
              <Op>=</Op>
              <Frac
                n={
                  <>
                    {w('M')} <V>M</V>
                    <Op>+</Op>
                    {w('V')} <V>V</V> / <V>k</V>
                  </>
                }
                d={
                  <>
                    {w('M')}
                    <Op>+</Op>
                    {w('V')}
                  </>
                }
              />
            </Formula>
            <ol className="flex flex-col">
              {ITEMS.map((it) => (
                <li key={it.n} className="grid grid-cols-[2.5rem_1fr] gap-3 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0">
                  <span className="data pt-0.5 text-xs text-ink-mute">{it.n}</span>
                  <div>
                    <h3 className="card-title">{t(it.title)}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink-dim">{t(it.body)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
