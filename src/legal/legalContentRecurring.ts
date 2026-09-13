import {
  LEGAL_DOCUMENTS as LEGAL_V2_DOCUMENTS,
  LEGAL_EFFECTIVE_DATE as LEGAL_V2_EFFECTIVE_DATE,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  LEGAL_VERSION as LEGAL_V2_VERSION,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV2';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = LEGAL_V2_VERSION;
export const LEGAL_EFFECTIVE_DATE = LEGAL_V2_EFFECTIVE_DATE;

const SAAS_PAYMENT_METHODS: LegalSection = {
  title: '10. Contratação do SaaS, recorrência e liberação',
  paragraphs: [
    'A contratação pode exigir autorização prévia de meio de pagamento recorrente suportado. A autorização, isoladamente, não representa cobrança da mensalidade, pagamento confirmado, aprovação definitiva do cadastro nem liberação automática do ambiente.',
    'Por segurança, homologação, prevenção a fraude ou procedimento operacional, o KÔMA pode exigir liberação administrativa antes do provisionamento do restaurante. Se uma sincronização indispensável com o provedor de pagamento falhar, a ativação pode permanecer pendente até a regularização.',
    'Os métodos recorrentes atualmente modelados para novas contratações são cartão de crédito, Pix Automático e Saldo Mercado Pago (account_money), sujeitos à homologação, às capacidades publicadas pelo backend e à disponibilidade do provedor. Pix avulso antecipado não integra o checkout de novas assinaturas SaaS.',
  ],
};

const COMMERCIAL_PAYMENT_METHODS: LegalSection = {
  title: '6. Autorização recorrente e métodos de pagamento',
  paragraphs: [
    'Toda nova contratação publicada no checkout deve utilizar meio recorrente homologado. Os métodos atualmente modelados são cartão de crédito, Pix Automático e Saldo Mercado Pago (account_money), sujeitos à disponibilidade, às capacidades publicadas pelo backend e à homologação do provedor.',
    'A autorização não cobra o componente fixo no ato e não garante liberação imediata. Pix avulso ou QR Code antecipado não é método válido para novas assinaturas SaaS.',
    'Métodos adicionais só podem ser anunciados quando suportarem a mesma regra canônica de autorização recorrente, trial e cobrança posterior.',
  ],
};

function replaceSection(document: LegalDocument, replacement: LegalSection): LegalDocument {
  return {
    ...document,
    version: LEGAL_VERSION,
    effectiveDate: LEGAL_EFFECTIVE_DATE,
    sections: document.sections.map((section) =>
      section.title === replacement.title ? replacement : section,
    ),
  };
}

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V2_DOCUMENTS.map((document) => {
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

  if (document.slug === 'termos') current = replaceSection(current, SAAS_PAYMENT_METHODS);
  if (document.slug === 'planos') current = replaceSection(current, COMMERCIAL_PAYMENT_METHODS);
  return current;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
