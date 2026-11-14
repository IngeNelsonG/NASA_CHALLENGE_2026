import { useT } from '@/app/i18n';
import { Analyst } from '@/features/analyst/Analyst';
import { Anomalies } from '@/features/anomalies/Anomalies';
import { Explorer } from '@/features/explorer/Explorer';
import { PickPanel, SatCard } from '@/features/explorer/Floating';
import { Methodology } from '@/features/methodology/Methodology';
import { Transparency } from '@/features/transparency/Transparency';
import { Footer } from './Footer';
import { Header } from './Header';
import { Hero } from './Hero';
import { OrbitNav } from './OrbitNav';
import { Team } from './Team';

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
        {/* the explorer holds the globe and, right under it, the burn calendar */}
        <Explorer />
        <Anomalies />
        <Analyst />
        <Methodology />
        <Transparency />
        <Team />
      </main>
      <Footer />
      <SatCard />
      <PickPanel />
    </div>
  );
}
