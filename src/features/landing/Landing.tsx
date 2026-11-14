import { lazy, Suspense } from 'react';
import { useT } from '@/app/i18n';
import { Spinner } from '@/components/ui';
import { Analyst } from '@/features/analyst/Analyst';
import { Anomalies } from '@/features/anomalies/Anomalies';
import { Explorer } from '@/features/explorer/Explorer';
import { PickPanel, SatCard } from '@/features/explorer/Floating';
import { Methodology } from '@/features/methodology/Methodology';
import { Transparency } from '@/features/transparency/Transparency';
import { Credits } from './Credits';
import { Header } from './Header';
import { Hero } from './Hero';
import { OrbitNav } from './OrbitNav';
import { Problem } from './Problem';

const CalendarSection = lazy(() => import('@/features/calendar/CalendarSection'));

export default function Landing() {
  const t = useT();
  return (
    <div className="fade-opacity relative z-10">
      <a href="#main" className="btn btn-primary fixed left-3 top-3 z-50 -translate-y-20 focus:translate-y-0">
        {t('nav.skip')}
      </a>
      <Header />
      <OrbitNav />
      <main id="main">
        <Hero />
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
        <Transparency />
        <Analyst />
        <Credits />
      </main>
      <SatCard />
      <PickPanel />
    </div>
  );
}
