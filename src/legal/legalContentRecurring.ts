import {
  LEGAL_DOCUMENTS as LEGAL_V2_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV2';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '2.4';
export const LEGAL_EFFECTIVE_DATE = '15/09/2026';

const AGE_RESTRICTED_TERMS: LegalSection = {
  title: '7. Produtos sujeitos a restrição etária',
  paragraphs: [
    'O KÔMA adota política restritiva para produtos sujeitos a restrição etária: o cardápio e o checkout online não são canais destinados à oferta de bebidas alcoólicas ou de outros itens que devam ser classificados como 18+ ou equivalente.',
    'Enquanto o recurso de classificação automática ainda não estiver disponível, o estabelecimento deve manter esses itens fora do cardápio online. Quando a identificação por tag 18+ ou classificação equivalente estiver habilitada, a marcação deverá funcionar como gate de publicação e sincronização, impedindo que o item seja transferido, publicado ou disponibilizado para compra no cardápio online.',
    'O item restrito poderá permanecer no catálogo interno, PDV ou operação presencial quando sua comercialização for legal e o estabelecimento cumprir as verificações e demais obrigações aplicáveis. O restaurante continua responsável por classificar corretamente os produtos e o KÔMA poderá ocultar, bloquear ou rejeitar a publicação online de item identificado como restrito.',
  ],
};

const CARDAPIO_AGE_RESTRICTED_TERMS: LegalSection = {
  title: '8. Produtos 18+',
  paragraphs: [
    'O cardápio online KÔMA não é destinado à oferta de bebidas alcoólicas ou de outros produtos classificados como 18+ ou sujeitos a restrição etária equivalente.',
    'Enquanto a classificação automática ainda não estiver disponível, o restaurante deve manter esses produtos fora do cardápio online. Quando a tag 18+ ou mecanismo equivalente estiver habilitado, itens assim classificados deverão ser excluídos da publicação e da sincronização com o cardápio online, permanecendo apenas nos canais internos ou presenciais em que a venda seja legal.',
    'Se um item sujeito a restrição aparecer online por erro de cadastro ou classificação, o restaurante e o KÔMA poderão ocultá-lo, bloquear sua compra ou rejeitar sua publicação. Essa limitação não impede o estabelecimento de comercializar presencialmente o produto quando permitido por lei e observadas as verificações exigidas.',
  ],
};

const SAAS_PAYMENT_METHODS: LegalSection = {
  title: '10. Contratação do SaaS, pagamento e liberação',
  paragraphs: [
    'A contratação pode exigir seleção ou autorização prévia de um meio de pagamento suportado. Essa etapa, isoladamente, não representa cobrança da mensalidade, pagamento confirmado, aprovação definitiva do cadastro nem liberação automática do ambiente.',
    'Por segurança, homologação, prevenção a fraude ou procedimento operacional, o KÔMA pode exigir liberação administrativa antes do provisionamento do restaurante. Se uma sincronização indispensável com o provedor de pagamento falhar, a ativação pode permanecer pendente até a regularização.',
    'Os meios publicados para novas contratações são cartão de crédito, Pix Automático e Saldo Mercado Pago (account_money), sujeitos às capacidades do backend e à disponibilidade do provedor. Os três meios são tratados como autorizações recorrentes; Pix avulso por QR Code não é usado como substituto de Pix Automático no checkout da assinatura.',
    'No Pix Automático, a autorização da recorrência é concluída no ambiente seguro disponibilizado pelo provedor. O KÔMA somente considera o meio financeiro confirmado depois de validar a autorização retornada pelo provedor, inclusive a identificação do método Pix, o valor contratado, a moeda e o período gratuito aplicável.',
  ],
};

const FREE_TRIAL_TERMS: LegalSection = {
  title: '11. Teste gratuito',
  paragraphs: [
    'Salvo oferta individual diferente, a nova contratação elegível recebe 7 dias completos de teste sem cobrança do componente fixo. O período não começa durante o preenchimento da inscrição, aceite, criação de senha ou implantação inicial.',
    'Para a oferta padrão, o teste começa quando o restaurante conclui os três passos essenciais indicados pelo KÔMA: dados básicos do estabelecimento, horários de funcionamento e ao menos um produto efetivamente publicado no catálogo. A conclusão é apurada pelos dados reais salvos na plataforma, e não por simples marcação manual de checklist.',
    'Para cartão, Pix Automático e Saldo Mercado Pago, o KÔMA deve preservar R$ 0 de mensalidade fixa hoje e alinhar a autorização recorrente para que a primeira cobrança somente possa ocorrer depois da implantação essencial e dos 7 dias grátis completos.',
    'Durante o teste já iniciado, pagamentos online reais processados pelo sistema podem gerar a taxa percentual do plano e tarifas do respectivo provedor. O componente fixo da assinatura somente se torna exigível após o término do teste.',
    'O contratante pode cancelar a autorização recorrente antes da primeira cobrança, observadas as regras operacionais do meio escolhido e do provedor de pagamento. O cancelamento da assinatura impede novas cobranças recorrentes pelo KÔMA após sua efetivação.',
  ],
};

const COMMERCIAL_PAYMENT_METHODS: LegalSection = {
  title: '6. Métodos de pagamento da assinatura',
  paragraphs: [
    'O checkout KÔMA publica três meios: cartão de crédito, Pix Automático e Saldo Mercado Pago (account_money), sujeitos à disponibilidade e às capacidades publicadas pelo backend.',
    'Os três meios são recorrentes. Cartão é autorizado com token seguro; Pix Automático e Saldo Mercado Pago concluem a autorização no ambiente seguro do provedor. O KÔMA não apresenta Pix avulso por QR Code como se fosse uma autorização recorrente.',
    'Nenhum dos três meios cobra a mensalidade fixa no ato da contratação. A implantação inicial não consome os 7 dias grátis; o trial começa somente quando os passos essenciais da configuração forem concluídos e a primeira cobrança recorrente deve permanecer posterior ao fim desse período.',
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

  if (document.slug === 'termos') {
    current = replaceSection(current, AGE_RESTRICTED_TERMS);
    current = replaceSection(current, SAAS_PAYMENT_METHODS);
    current = replaceSection(current, FREE_TRIAL_TERMS);
  }
  if (document.slug === 'planos') current = replaceSection(current, COMMERCIAL_PAYMENT_METHODS);
  if (document.slug === 'cardapio-termos') current = replaceSection(current, CARDAPIO_AGE_RESTRICTED_TERMS);
  return current;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
