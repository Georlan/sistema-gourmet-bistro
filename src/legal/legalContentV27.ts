import {
  LEGAL_DOCUMENTS as LEGAL_V26_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV26';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '2.7';
export const LEGAL_EFFECTIVE_DATE = '20/09/2026';

const FREE_TRIAL_TERMS: LegalSection = {
  title: '11. Teste gratuito',
  paragraphs: [
    'O Pocket não depende de período de teste para isentar mensalidade fixa, pois o componente fixo contratado nesta versão é R$ 0.',
    'Salvo oferta individual diferente, novas contratações elegíveis de Pro e Premium recebem 7 dias completos de teste sem cobrança do componente fixo. O período não começa durante inscrição, aceite, criação de senha ou configuração inicial.',
    'Para Pro e Premium, concluir a configuração não inicia o teste automaticamente. Depois que os requisitos obrigatórios de configuração estiverem atendidos, um administrador ou gerente do restaurante inicia expressamente a operação pelo controle apresentado no KÔMA; esse ato inicia o período gratuito e libera o ambiente operacional.',
    'O primeiro pedido de validação, incluindo pagamento e conclusão, é usado como prova de prontidão operacional depois da liberação e não é o gatilho de início do período gratuito.',
    'Durante o uso do sistema, pagamentos online reais e elegíveis podem gerar a taxa percentual contratada do plano e tarifas separadas do respectivo provedor. O trial, quando aplicável, alcança somente o componente fixo.',
    'No Pix da mensalidade, cada QR Code é uma cobrança independente e não cria débito automático para períodos posteriores.',
  ],
};

const COMMERCIAL_TRIAL: LegalSection = {
  title: '7. Teste gratuito de 7 dias',
  paragraphs: [
    'O Pocket não necessita de isenção temporária do componente fixo, porque sua mensalidade fixa é R$ 0 nesta versão.',
    'Salvo oferta individual diferente, Pro e Premium são elegíveis a 7 dias grátis no componente fixo. A configuração inicial pode ser concluída sem consumir o período gratuito.',
    'O período de 7 dias começa somente quando um administrador ou gerente inicia expressamente a operação no KÔMA depois de a configuração obrigatória estar concluída. Apenas salvar perfil, horários, catálogo ou capacidades operacionais não inicia o trial.',
    'O pedido de teste realizado depois da liberação serve para validar a prontidão operacional e não altera a data de início já registrada.',
    'Pagamentos online reais processados durante eventual período de teste continuam sujeitos à taxa percentual contratada do plano e às tarifas separadas do provedor.',
    'O cancelamento da recorrência antes do fim do trial impede a primeira cobrança fixa quando houver componente fixo recorrente.',
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

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V26_DOCUMENTS.map((document) => {
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

  if (document.slug === 'termos') current = replaceSection(current, FREE_TRIAL_TERMS);
  if (document.slug === 'planos') current = replaceSection(current, COMMERCIAL_TRIAL);
  return current;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
