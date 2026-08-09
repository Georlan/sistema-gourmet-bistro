import React, { useEffect } from 'react';
import './landing.css';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { OperationFlow } from './sections/OperationFlow';
import { CardapioScene } from './sections/CardapioScene';
import { ImpactMoment } from './sections/ImpactMoment';
import { Ecosystem } from './sections/Ecosystem';
import { ValueStrip } from './sections/ValueStrip';
import { Management } from './sections/Management';
import { Reliability } from './sections/Reliability';
import { Plans } from './sections/Plans';
import { FinalCTA } from './sections/FinalCTA';

export default function LandingPage() {
  useEffect(() => {
    document.title = 'KÔMA | Sistema de gestão para restaurantes';

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

    setMeta('description', 'Sistema de gestão para restaurantes com PDV, mesas, comandas, KDS, caixa, cardápio digital por QR Code e impressão automática no mesmo fluxo.');
    setMeta('robots', 'index, follow, max-image-preview:large');
    setMeta('theme-color', '#0a0a0a');
    setMeta('og:title', 'KÔMA | Sistema de gestão para restaurantes', true);
    setMeta('og:description', 'Do pedido ao fechamento: salão, cozinha e caixa trabalhando no mesmo fluxo.', true);
    setMeta('og:type', 'website', true);
    setMeta('og:url', 'https://sistema-gourmet-bistro.pages.dev/landing', true);
    setMeta('og:locale', 'pt_BR', true);
    setMeta('twitter:card', 'summary_large_image');

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
    structuredData.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'KÔMA',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'pt-BR',
      description: 'Sistema de gestão para restaurantes com PDV, gestão de mesas, KDS, caixa e cardápio digital.',
      slogan: 'Se você está com fome, Kôma',
      offers: {
        '@type': 'AggregateOffer',
        lowPrice: '79',
        highPrice: '249',
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
        <ValueStrip />
        <ImpactMoment />
        <OperationFlow />
        <Ecosystem />
        <CardapioScene />
        <Management />
        <Reliability />
        <Plans />
        <FinalCTA />
      </main>
    </div>
  );
}
