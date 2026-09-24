import {
  LEGAL_DOCUMENTS as LEGAL_V30_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV30';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '3.1';
export const LEGAL_EFFECTIVE_DATE = '24/09/2026';

const POCKET_PLAN: LegalSection = {
  title: '2. KÔMA Pocket',
  bullets: [
    'Mesas, comandas e balcão.',
    'App do Garçom para atendimento de mesas e lançamento em comandas.',
    'Cardápio digital e QR Code com pedidos no PDV.',
    'Retirada e delivery no mesmo caixa.',
    'Fila de preparo na tela, sem KDS dedicado e sem impressão automática.',
    'Caixa, fechamento e resumo de vendas.',
    'Clientes e histórico de pedidos.',
    'Não inclui KDS dedicado e impressão automática, estoque/fichas técnicas/financeiro completo, gestão avançada de equipe, app do entregador ou pontos, cashback e cupons.',
  ],
};

const PRO_PLAN: LegalSection = {
  title: '3. KÔMA Pro',
  bullets: [
    'Inclui todos os recursos do Pocket, inclusive o App do Garçom.',
    'KDS e impressão automática quando a infraestrutura compatível estiver configurada.',
    'Estoque, fichas técnicas e financeiro.',
    'Gestão avançada de equipe e permissões.',
    'Relatórios gerenciais completos.',
    'Não inclui app do entregador nem pontos, cashback e cupons.',
  ],
};

function replaceSection(document: LegalDocument, replacement: LegalSection): LegalDocument {
  return {
    ...document,
    sections: document.sections.map((section) =>
      section.title === replacement.title ? replacement : section,
    ),
  };
}

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V30_DOCUMENTS.map((document) => {
  let current: LegalDocument = {
    ...document,
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: document.sections.map((section) => ({
      ...section,
      paragraphs: section.paragraphs ? [...section.paragraphs] : undefined,
      bullets: section.bullets ? [...section.bullets] : undefined,
    })),
  };

  if (document.slug === 'planos') {
    current = replaceSection(current, POCKET_PLAN);
    current = replaceSection(current, PRO_PLAN);
  }
  return current;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
