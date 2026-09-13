import {
  LEGAL_DOCUMENTS as LEGACY_LEGAL_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentLegacy';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '1.3';
export const LEGAL_EFFECTIVE_DATE = '13/09/2026';

const TERMS_TRIAL: LegalSection = {
  title: '7. Teste gratuito e promoções',
  paragraphs: [
    'Salvo oferta individual diferente, toda nova contratação elegível recebe 7 dias de teste sem cobrança da mensalidade fixa. O teste começa somente após a autorização recorrente e a liberação do acesso. A taxa percentual incidente sobre pagamentos online reais processados durante o período continua aplicável.',
    'Todo meio de pagamento disponibilizado no checkout da assinatura KÔMA deve ser recorrente. A autorização ocorre antes da liberação, mas a primeira cobrança automática da mensalidade fixa somente pode ocorrer após o término dos 7 dias grátis. Não existe pagamento antecipado da mensalidade fixa nem concessão de dias de bônus em substituição ao trial.',
    'O contratante pode cancelar a recorrência antes da primeira cobrança. Promoções futuras serão regidas pelas condições divulgadas na oferta específica e não alteram permanentemente o preço-base do plano.',
  ],
};

const ANNUAL_BILLING: LegalSection = {
  title: '5. Modalidade anual',
  paragraphs: [
    'Na modalidade anual, o componente fixo corresponde a 12 mensalidades com desconto de 10%. A autorização do meio recorrente ocorre na contratação, porém o total anual somente é cobrado automaticamente após os 7 dias grátis. As renovações seguintes são anuais até o cancelamento.',
    'O valor mensal equivalente mostrado na interface serve apenas para comparação econômica e não representa 12 parcelas. Não há cobrança antecipada no dia da adesão e não existem dias adicionais de bônus. A taxa percentual sobre pagamentos online permanece calculada por transação aprovada.',
  ],
};

const COMMERCIAL_TRIAL: LegalSection = {
  title: '7. Teste gratuito de 7 dias',
  paragraphs: [
    'Salvo oferta individual diferente, o primeiro teste do estabelecimento dura 7 dias a partir da liberação e isenta somente a mensalidade fixa. Transações online reais processadas durante o teste continuam sujeitas à taxa percentual do plano.',
    'Antes da liberação, o contratante autoriza um meio de pagamento recorrente suportado, como cartão de crédito ou Pix Automático. A autorização não cobra a mensalidade fixa no ato. A primeira cobrança automática, mensal ou anual conforme o ciclo escolhido, ocorre somente após o término dos 7 dias grátis e pode ser evitada mediante cancelamento anterior.',
    'O KÔMA não oferece Pix avulso antecipado como forma de pagamento da assinatura. Métodos adicionais somente poderão ser disponibilizados quando suportarem a mesma regra: autorização recorrente, R$ 0 de mensalidade fixa hoje, 7 dias grátis e cobrança automática posterior.',
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

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGACY_LEGAL_DOCUMENTS.map((document) => {
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

  if (document.slug === 'termos') current = replaceSection(current, TERMS_TRIAL);
  if (document.slug === 'planos') {
    current = replaceSection(current, ANNUAL_BILLING);
    current = replaceSection(current, COMMERCIAL_TRIAL);
  }
  return current;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
