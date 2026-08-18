import React, { useEffect } from 'react';
import './landing.css';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { ValueStrip } from './sections/ValueStrip';
import { SocialProof } from './sections/SocialProof';
import { HowItWorks } from './sections/HowItWorks';
import { FAQ } from './sections/FAQ';
import { Plans } from './sections/Plans';
import { FinalCTA } from './sections/FinalCTA';
import { SUBSCRIPTION_PLANS } from '../config/subscriptionPlans';
import { KOMA_SLOGAN } from '../brand/komaBrand';

type DividerVariant = 'dark-light' | 'light-dark' | 'light-green';

function AngleDivider({ variant }: { variant: DividerVariant }) {
  return <div className={`koma-angle-divider koma-angle-divider--${variant}`} aria-hidden="true" />;
}

export default function LandingPage() {
  useEffect(() => {
    document.title = 'KÔMA | Sistema para restaurantes, PDV, mesas e cozinha';

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

    setMeta('description', 'Sistema para restaurantes com PDV, gestão de mesas, comandas, KDS, caixa, cardápio digital e impressão automática. Conheça o Kôma.');
    setMeta('robots', 'index, follow, max-image-preview:large');
    setMeta('theme-color', '#0a0a0a');
    setMeta('og:title', 'KÔMA | Sistema para restaurantes, PDV, mesas e cozinha', true);
    setMeta('og:description', 'Pedidos, salão, cozinha, impressão e caixa conectados no mesmo sistema para restaurantes.', true);
    setMeta('og:type', 'website', true);
    setMeta('og:url', 'https://sistema-gourmet-bistro.pages.dev/landing', true);
    setMeta('og:locale', 'pt_BR', true);
    setMeta('og:site_name', 'KÔMA', true);
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', 'KÔMA | Sistema para restaurantes, PDV, mesas e cozinha');
    setMeta('twitter:description', 'Pedidos, salão, cozinha, impressão e caixa conectados no mesmo sistema para restaurantes.');

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = 'https://sistema-gourmet-bistro.pages.dev/landing';

    const structuredData = document.createElement('script');
    structuredData.type = 'application/ld+json';
    structuredData.id = 'koma-software-schema';
    const planPrices = SUBSCRIPTION_PLANS.map((plan) => plan.price);

    structuredData.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'KÔMA',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: 'https://sistema-gourmet-bistro.pages.dev/landing',
      inLanguage: 'pt-BR',
      description: 'Sistema de gestão para restaurantes com PDV, gestão de mesas, KDS, caixa e cardápio digital.',
      slogan: KOMA_SLOGAN,
      featureList: [
        'PDV e frente de caixa',
        'Gestão de mesas e comandas',
        'KDS para cozinha',
        'Cardápio digital por QR Code',
        'Impressão automática de pedidos',
      ],
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: String(Math.min(...planPrices)),
        highPrice: String(Math.max(...planPrices)),
        priceCurrency: 'BRL',
      },
    });
    document.getElementById(structuredData.id)?.remove();
    document.head.appendChild(structuredData);

    window.scrollTo(0, 0);

    return () => structuredData.remove();
  }, []);

  return (
    <div className="koma-landing">
      <Header />
      <main>
        <Hero />
        <AngleDivider variant="dark-light" />
        <ValueStrip />
        <SocialProof />
        <AngleDivider variant="light-dark" />
        <HowItWorks />
        <AngleDivider variant="dark-light" />
        <FAQ />
        <Plans />
        <AngleDivider variant="light-green" />
        <FinalCTA />
      </main>
    </div>
  );
}
