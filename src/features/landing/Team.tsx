import { useT } from '@/app/i18n';
import { Reveal, RollText, SectionHeading } from '@/components/ui';

const TEAM_URL = 'https://www.spaceappschallenge.org/2026/find-a-team/ustacode1/?tab=members';

/** As listed on the team's Space Apps page. */
const MEMBERS: { name: string; owner?: boolean }[] = [
  { name: 'Nelson Felipe Gonzalez Gordillo', owner: true },
  { name: 'Jean Carlos Reyes' },
  { name: 'Daniel Esteban Alarcón Rojas' },
  { name: 'Edgard Leonardo Patiño Largo' },
];
// each card rests slightly askew, like prints on a table, and straightens on hover
const TILT = ['-rotate-2', 'rotate-1', '-rotate-1', 'rotate-2'];

const initials = (name: string) => {
  const p = name.split(' ');
  return (p[0][0] + (p.length > 2 ? p[p.length - 2][0] : p[p.length - 1][0])).toUpperCase();
};

export function Team() {
  const t = useT();
  const base = import.meta.env.BASE_URL;
  return (
    <section id="team" className="section" aria-labelledby="team-title">
      <SectionHeading id="team-title" eyebrow={t('team.eyebrow')} title="USTACODE" lead={t('team.lead')} />

      <ul className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
        {MEMBERS.map((m, i) => (
          <li key={m.name}>
            <Reveal delay={i * 90}>
              <article
                className={`panel flex h-full min-h-[13.5rem] flex-col p-4 transition-transform duration-500 ease-out hover:-translate-y-1.5 hover:rotate-0 sm:min-h-[15rem] sm:p-5 ${TILT[i % TILT.length]}`}
              >
                <p aria-hidden className="font-display text-5xl font-light leading-none text-cream sm:text-6xl">
                  {initials(m.name)}
                </p>
                <h3 className="mt-auto pt-6 text-[15px] font-semibold leading-snug text-ink sm:text-base">{m.name}</h3>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-dim">
                  {m.owner && <span className="chip !border-ember/60 !py-0.5 text-ink">{t('team.owner')}</span>}
                  <span>Colombia</span>
                </p>
              </article>
            </Reveal>
          </li>
        ))}
      </ul>

      <Reveal delay={120} className="mx-auto mt-10 max-w-5xl lg:mt-14">
        <div className="panel grid items-center gap-6 p-5 sm:grid-cols-[auto_1fr_auto] sm:gap-8 sm:p-7">
          <div className="flex items-center gap-4">
            <img
              src={`${base}brand/usta-logo.png`}
              alt="Universidad Santo Tomás"
              width={280}
              height={280}
              loading="lazy"
              className="h-20 w-20 shrink-0 rounded-full bg-white object-cover sm:h-24 sm:w-24"
            />
            <div className="sm:hidden">
              <p className="font-semibold text-ink">Universidad Santo Tomás</p>
              <p className="text-xs text-ink-dim">{t('team.event')}</p>
            </div>
          </div>
          <div>
            <p className="hidden font-semibold text-ink sm:block">Universidad Santo Tomás</p>
            <p className="hidden text-sm text-ink-dim sm:block">{t('team.event')}</p>
            <p className="text-sm leading-relaxed text-ink-dim sm:mt-2">{t('team.challenge')}</p>
            <a href={TEAM_URL} target="_blank" rel="noreferrer" className="btn btn-primary mt-4 !px-5">
              <RollText>{t('team.link')}</RollText>
              <span aria-hidden className="btn-plus">+</span>
            </a>
          </div>
          <img
            src={`${base}brand/space-apps-logo.png`}
            alt="NASA Space Apps Challenge"
            width={440}
            height={172}
            loading="lazy"
            className="h-auto w-44 justify-self-start sm:w-52 sm:justify-self-end"
          />
        </div>
      </Reveal>
    </section>
  );
}
