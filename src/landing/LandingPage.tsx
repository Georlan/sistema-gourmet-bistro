import React, { useEffect } from 'react';
import './landing.css';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { ProductShowcase } from './sections/ProductShowcase';
import { OperationFlow } from './sections/OperationFlow';
import { CardapioScene } from './sections/CardapioScene';
import { ImpactMoment } from './sections/ImpactMoment';
import { Ecosystem } from './sections/Ecosystem';
import { FinalCTA } from './sections/FinalCTA';

export default function LandingPage() {
  useEffect(() => {
    document.title = 'KÔMA — Sistema de gestão para restaurantes';

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

    setMeta('description', 'KÔMA centraliza a operação do seu restaurante: PDV, mesas, cozinha, cardápio digital, delivery e impressão automática em um único sistema.');
    setMeta('theme-color', '#0a0a0a');
    setMeta('og:title', 'KÔMA — Sistema de gestão para restaurantes', true);
    setMeta('og:description', 'PDV, mesas, cozinha, cardápio digital, delivery e impressão em um único sistema.', true);
    setMeta('og:type', 'website', true);

    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="koma-landing">
      <Header />
      <main>
        <Hero />
        <ProductShowcase />
        <OperationFlow />
        <CardapioScene />
        <ImpactMoment />
        <Ecosystem />
        <FinalCTA />
      </main>
    </div>
  );
}
