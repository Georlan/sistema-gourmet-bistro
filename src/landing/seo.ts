import { SUBSCRIPTION_PLANS } from '../config/subscriptionPlans';

export const LANDING_SEO = {
  url: 'https://komafood.com.br/',
  title: 'KÔMA | Sistema para restaurantes, PDV, mesas e cozinha',
  description: 'Sistema para restaurantes com PDV, mesas, comandas, caixa e cardápio digital. KDS, impressão automática e recursos avançados disponíveis conforme o plano.',
  image: 'https://komafood.com.br/logo-koma.png',
};

export function landingStructuredData(slogan: string) {
  const prices = SUBSCRIPTION_PLANS.map(plan => plan.price);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization', '@id': `${LANDING_SEO.url}#organization`,
        name: 'KÔMA', alternateName: ['Koma', 'Koma Food'],
        url: LANDING_SEO.url, logo: LANDING_SEO.image,
      },
      {
        '@type': 'WebSite', '@id': `${LANDING_SEO.url}#website`,
        name: 'KÔMA', alternateName: 'Koma Food', url: LANDING_SEO.url,
        inLanguage: 'pt-BR', publisher: { '@id': `${LANDING_SEO.url}#organization` },
      },
      {
        '@type': 'SoftwareApplication', name: 'KÔMA',
        applicationCategory: 'BusinessApplication', operatingSystem: 'Web',
        url: LANDING_SEO.url, inLanguage: 'pt-BR',
        description: LANDING_SEO.description, slogan,
        publisher: { '@id': `${LANDING_SEO.url}#organization` },
        featureList: ['PDV e frente de caixa', 'Gestão de mesas e comandas',
          'Cardápio digital por QR Code', 'Fila de preparo na tela',
          'KDS e impressão automática nos planos compatíveis'],
        offers: { '@type': 'AggregateOffer', lowPrice: String(Math.min(...prices)),
          highPrice: String(Math.max(...prices)), priceCurrency: 'BRL' },
      },
    ],
  };
}

export function serializeStructuredData(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
