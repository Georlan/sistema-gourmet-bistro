import {
  LEGAL_DOCUMENTS as LEGAL_V32_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV32';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '3.3';
export const LEGAL_EFFECTIVE_DATE = '27/09/2026';

const updatedTrialTerms = new Map<string, string>([
  [
    'Para Pocket, Pro e Premium, a implantação mínima exige dados básicos do estabelecimento, horários de funcionamento, ao menos um produto ativo publicado no catálogo e modalidades de operação configuradas. Após concluir esses quatro itens, o administrador deve acionar o início do período grátis no KÔMA; somente então começam os 7 dias completos.',
    'Para Pocket, Pro e Premium, a implantação mínima exige dados básicos do estabelecimento, horários de funcionamento, ao menos um produto ativo publicado no catálogo e modalidades de operação configuradas. Após concluir esses quatro itens, a equipe KÔMA confere a implantação e libera a operação por meio do SuperAdmin; somente nessa liberação começam os 7 dias completos.',
  ],
  [
    'O Pocket desta versão é elegível ao teste gratuito de 7 dias do componente fixo após a implantação essencial e o início explícito pelo administrador.',
    'O Pocket desta versão é elegível ao teste gratuito de 7 dias do componente fixo após a implantação essencial e a liberação explícita pelo SuperAdmin KÔMA.',
  ],
  [
    'Salvo oferta individual diferente, Pocket, Pro e Premium são elegíveis a 7 dias grátis no componente fixo após a conclusão dos quatro itens de implantação essencial e o início explícito pelo administrador no KÔMA.',
    'Salvo oferta individual diferente, Pocket, Pro e Premium são elegíveis a 7 dias grátis no componente fixo após a conclusão dos quatro itens de implantação essencial e a liberação explícita pelo SuperAdmin KÔMA.',
  ],
]);

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V32_DOCUMENTS.map((document) => ({
  ...document,
  version: LEGAL_VERSION,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  sections: document.sections.map((section) => ({
    ...section,
    paragraphs: section.paragraphs?.map((paragraph) => updatedTrialTerms.get(paragraph) || paragraph),
    bullets: section.bullets ? [...section.bullets] : undefined,
  })),
}));

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
