import React, { useEffect, useState } from 'react';
import './landing.css';
import { SUBSCRIPTION_PLANS } from '../config/subscriptionPlans';
import { KOMA_SLOGAN } from '../brand/komaBrand';
import { LeadCaptureModal } from './components/LeadCaptureModal';
import { WhatsAppIcon } from './components/WhatsAppIcon';
import { KOMA_LANDING_CONFIG } from './config/landingConfig';
import { Header } from './sections/Header';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { FAQ } from './sections/FAQ';
import { Plans } from './sections/Plans';
import { FinalCTA } from './sections/FinalCTA';

export default function LandingPage() {
  const [leadModalOpen, setLeadModalOpen] = useState(false);
  const [mobileConversionVisible, setMobileConversionVisible] = useState(false);

  useEffect(() => {
    document.title = 'KÔMA | Gestão completa para restaurantes';

    const setMeta = (nameOrProp: string, content: string, isProperty = false) => {
      const attr = isProperty ? 'property' : 'name';
      let element = document.querySelector(`meta[${attr}="${nameOrProp}"]`);
      if (!element) {
        element = document.createElement('meta');
        element.setAttribute(attr, nameOrProp);
        document.head.appendChild(element);
      }
      element.setAttribute('content', content);
    };

    const title = 'KÔMA | Gestão completa para restaurantes';
    const description = 'Pedidos, salão, cozinha, impressão, caixa e cardápio digital conectados em um único sistema para restaurantes.';

    setMeta('description', description);
    setMeta('robots', 'index, follow, max-image-preview:large');
    setMeta('theme-color', '#07110e');
    setMeta('og:title', title, true);
    setMeta('og:description', description, true);
    setMeta('og:type', 'website', true);
    setMeta('og:url', 'https://sistema-gourmet-bistro.pages.dev/landing', true);
    setMeta('og:locale', 'pt_BR', true);
    setMeta('og:site_name', 'KÔMA', true);
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', title);
    setMeta('twitter:description', description);

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
      description,
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

  useEffect(() => {
    const updateMobileConversion = () => {
      setMobileConversionVisible(window.scrollY > Math.min(window.innerHeight * 0.7, 560));
    };
    updateMobileConversion();
    window.addEventListener('scroll', updateMobileConversion, { passive: true });
    window.addEventListener('resize', updateMobileConversion);
    return () => {
      window.removeEventListener('scroll', updateMobileConversion);
      window.removeEventListener('resize', updateMobileConversion);
    };
  }, []);

  const openLeadModal = () => setLeadModalOpen(true);

  return (
    <div className="koma-landing">
      <Header onOpenLead={openLeadModal} />
      <main>
        <Hero onOpenLead={openLeadModal} />
        <HowItWorks />
        <FAQ />
        <Plans onOpenLead={openLeadModal} />
        <FinalCTA onOpenLead={openLeadModal} />
      </main>

      <div className={`koma-mobile-conversion ${mobileConversionVisible ? 'is-visible' : ''}`} aria-label="Ações rápidas">
        <a href={KOMA_LANDING_CONFIG.whatsappUrl} target="_blank" rel="noopener noreferrer" aria-label="Falar no WhatsApp">
          <WhatsAppIcon />
        </a>
        <button type="button" onClick={openLeadModal}>Agendar demonstração</button>
      </div>

      <LeadCaptureModal open={leadModalOpen} onClose={() => setLeadModalOpen(false)} />
    </div>
  );
}
