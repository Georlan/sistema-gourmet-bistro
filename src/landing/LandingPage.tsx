import React, { useEffect } from 'react';
import './landing.css';
import './mobile-refinement.css';
import './plan-comparison.css';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { ValueStrip } from './sections/ValueStrip';
import { SocialProof } from './sections/SocialProof';
import { Management } from './sections/Management';
import { HowItWorks } from './sections/HowItWorks';
import { LeadCaptureProvider } from './components/LeadCaptureProvider';
import { Implementation } from './sections/Implementation';
import { FAQ } from './sections/FAQ';
import { Plans } from './sections/Plans';
import { FinalCTA } from './sections/FinalCTA';
import { LANDING_SEO, landingStructuredData, serializeStructuredData } from './seo';
import { KOMA_SLOGAN } from '../brand/komaBrand';

type DividerVariant = 'dark-light' | 'light-dark' | 'light-green';

function AngleDivider({ variant }: { variant: DividerVariant }) {
  return <div className={`koma-angle-divider koma-angle-divider--${variant}`} aria-hidden="true" />;
}

export default function LandingPage() {
  useEffect(() => {
    document.title = LANDING_SEO.title;

    const setMeta = (nameOrProp: string, content: string, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let el = document.querySelector(`meta[${attr}="${nameOrProp}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, nameOrProp);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    setMeta('description', LANDING_SEO.description);
    setMeta('robots', 'index, follow, max-image-preview:large');
    setMeta('theme-color', '#0a0a0a');
    setMeta('og:title', LANDING_SEO.title, true);
    setMeta('og:description', LANDING_SEO.description, true);
    setMeta('og:type', 'website', true);
    setMeta('og:url', LANDING_SEO.url, true);
    setMeta('og:image', LANDING_SEO.image, true);
    setMeta('og:image:alt', 'KÔMA — Sistema para restaurantes', true);
    setMeta('og:locale', 'pt_BR', true);
    setMeta('og:site_name', 'KÔMA', true);
    setMeta('twitter:card', 'summary');
    setMeta('twitter:image', LANDING_SEO.image);
    setMeta('twitter:title', LANDING_SEO.title);
    setMeta('twitter:description', LANDING_SEO.description);

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = LANDING_SEO.url;

    const structuredData = document.createElement('script');
    structuredData.type = 'application/ld+json';
    structuredData.id = 'koma-software-schema';
    structuredData.text = serializeStructuredData(landingStructuredData(KOMA_SLOGAN));
    document.getElementById(structuredData.id)?.remove();
    document.head.appendChild(structuredData);

    if (!window.location.hash) window.scrollTo(0, 0);
    else requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView());

    return () => structuredData.remove();
  }, []);

  return (
    <div className="koma-landing">
      <LeadCaptureProvider>
        <Header />
        <main>
          <Hero />
          <AngleDivider variant="dark-light" />
          <SocialProof />
          <ValueStrip />
          <Management />
          <AngleDivider variant="light-dark" />
          <HowItWorks />
          <AngleDivider variant="dark-light" />
          <Implementation />
          <Plans />
          <FAQ />
          <AngleDivider variant="light-dark" />
          <FinalCTA />
        </main>
      </LeadCaptureProvider>
    </div>
  );
}
