import { useT } from '@/app/i18n';
import { Reveal, Sparkle, SplitWords } from '@/components/ui';

/** One large centred sentence between the hero and the content, with the star as punctuation. */
export function Statement() {
  const t = useT();
  return (
    <section id="statement" className="section !py-24 text-center lg:!py-36" aria-label={t('statement.eyebrow')}>
      <Reveal>
        <p className="eyebrow">{t('statement.eyebrow')}</p>
      </Reveal>
      <p className="mx-auto mt-6 max-w-5xl text-[1.7rem] font-normal leading-[1.35] sm:text-4xl sm:leading-[1.4] lg:text-[2.75rem]">
        <SplitWords text={t('statement.a')} step={28} />
        <Sparkle className="mx-3 inline-block h-[0.8em] w-[0.8em] align-[-0.06em] text-ember" />
        <SplitWords text={t('statement.b')} step={28} />
      </p>
    </section>
  );
}
