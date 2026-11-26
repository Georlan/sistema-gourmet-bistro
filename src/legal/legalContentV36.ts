import {
  LEGAL_DOCUMENTS as LEGAL_V35_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV35';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '3.6';
export const LEGAL_EFFECTIVE_DATE = '26/11/2026';

const PLANOS_SECTION_CATALOGO: LegalSection = {
  title: '1. Catálogo e preços',
  bullets: [
    'Pocket: R$ 99,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis.',
    'Pro: R$ 179,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis.',
    'Premium: R$ 329,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis.',
    'A implantação padrão é gratuita. Caso o contratante opte pela Implantação VIP opcional (cadastro assistido de até 80 produtos com complementos e sessão remota de 45 minutos), o valor único é de R$ 299,00.',
    'Módulos especializados futuros (como iFood, Totem, Financeiro gerencial avançado e Fiscal) não estão disponíveis para contratação nesta versão e dependem de homologação específica.',
    'Tarifas de gateways, adquirentes, bancos, Mercado Pago e PagBank permanecem separadas e são pagas pelo estabelecimento diretamente ao provedor conectado.',
    'Valores e condições já aceitos em contratos anteriores permanecem preservados nos respectivos comprovantes.',
  ],
};

function replaceSectionByNumber(sections: LegalSection[], updated: LegalSection): LegalSection[] {
  const numberPrefix = `${updated.title.split('.', 1)[0]}.`;
  const index = sections.findIndex((section) => section.title.startsWith(numberPrefix));
  if (index === -1) return [...sections, updated];
  return sections.map((section, current) => (current === index ? updated : section));
}

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V35_DOCUMENTS.map((baseDoc) => {
  const doc: LegalDocument = {
    ...baseDoc,
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: baseDoc.sections.map((section) => ({
      ...section,
      paragraphs: section.paragraphs ? [...section.paragraphs] : undefined,
      bullets: section.bullets ? [...section.bullets] : undefined,
    })),
  };

  if (doc.slug === 'planos') {
    doc.sections = replaceSectionByNumber(doc.sections, PLANOS_SECTION_CATALOGO);
  }

  return doc;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
