import { lazy, Suspense } from 'react';
import { useT } from '@/app/i18n';
import { Spinner } from '@/components/ui';
import { Analyst } from '@/features/analyst/Analyst';
import { Anomalies } from '@/features/anomalies/Anomalies';
import { Explorer } from '@/features/explorer/Explorer';
import { PickPanel, SatCard } from '@/features/explorer/Floating';
import { Methodology } from '@/features/methodology/Methodology';
import { Credits } from './Credits';
import { Header } from './Header';
import { Hero } from './Hero';
import { OrbitNav } from './OrbitNav';
import { Problem } from './Problem';
import { Statement } from './Statement';
import { Team } from './Team';

const CalendarSection = lazy(() => import('@/features/calendar/CalendarSection'));

export default function Landing() {
  const t = useT();
  return (
    <div className="fade-opacity relative z-10 overflow-x-clip">
      <a href="#main" className="btn btn-primary fixed left-3 top-3 z-50 -translate-y-20 focus:translate-y-0">
        {t('nav.skip')}
      </a>
      <Header />
      <OrbitNav />
      <main id="main">
        <Hero />
        <Statement />
        <Problem />
        <Explorer />
        <Suspense
          fallback={
            <section id="calendar" className="section grid min-h-[70vh] place-items-center">
              <Spinner label={t('common.loading')} />
            </section>
          }
        >
          <CalendarSection />
        </Suspense>
        <Anomalies />
        <Methodology />
        <Analyst />
        <Team />
        <Credits />
      </main>
      <SatCard />
      <PickPanel />
    </div>
  );
}
