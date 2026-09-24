import {
  LEGAL_DOCUMENTS as LEGAL_V25_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentRecurring';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '3.0';
export const LEGAL_EFFECTIVE_DATE = '24/09/2026';

const SAAS_PAYMENT_METHODS: LegalSection = {
  title: '10. Contratação do SaaS, pagamento e liberação',
  paragraphs: [
    'A contratação do Pocket desta versão tem mensalidade fixa de R$ 39,00 e exige seleção de meio de pagamento disponível. Contratos anteriores com mensalidade fixa de R$ 0 preservam seus termos aceitos e não criam recorrência de valor zero no provedor.',
    'Nos planos Pocket, Pro e Premium, a contratação pode exigir seleção ou autorização prévia de meio de pagamento suportado para o componente fixo. A autorização, isoladamente, não representa cobrança, pagamento confirmado ou liberação automática do ambiente.',
    'Os meios publicados para cobrança fixa, quando aplicáveis, são cartão de crédito, Pix por QR Code e Pix Copia e Cola interoperável e Saldo Mercado Pago (account_money), sujeitos às capacidades do backend e à disponibilidade do provedor.',
    'Pagamentos online dos clientes do restaurante são processados na conta Mercado Pago conectada pelo próprio estabelecimento e são independentes da cobrança da mensalidade SaaS. A taxa KÔMA contratada e as tarifas do provedor são componentes distintos.',
    'Por segurança, homologação, prevenção a fraude ou procedimento operacional, o KÔMA pode exigir liberação administrativa antes do provisionamento. Se uma sincronização financeira indispensável falhar, a mudança correspondente não deve ser considerada concluída até a regularização.',
  ],
};

const FREE_TRIAL_TERMS: LegalSection = {
  title: '11. Teste gratuito',
  paragraphs: [
    'O Pocket desta versão é elegível ao teste gratuito do componente fixo, nas mesmas condições dos planos Pro e Premium.',
    'Salvo oferta individual diferente, novas contratações elegíveis de Pocket, Pro e Premium recebem 7 dias completos de teste sem cobrança do componente fixo. O período não começa durante inscrição, aceite, criação de senha ou implantação inicial.',
    'Para Pocket, Pro e Premium, a implantação mínima exige dados básicos do estabelecimento, horários de funcionamento, ao menos um produto ativo publicado no catálogo e modalidades de operação configuradas. Após concluir esses quatro itens, o administrador deve acionar o início do período grátis no KÔMA; somente então começam os 7 dias completos.',
    'Durante o uso do sistema, pagamentos online reais e elegíveis podem gerar a taxa percentual contratada do plano e tarifas separadas do respectivo provedor. O trial, quando aplicável, alcança somente o componente fixo.',
    'No Pix da mensalidade, cada QR Code é uma cobrança independente e não cria débito automático para períodos posteriores.',
  ],
};

const COMMERCIAL_CATALOG: LegalSection = {
  title: '1. Catálogo e preços',
  bullets: [
    'Pocket: R$ 39,00 por mês + 1,79% sobre pagamentos online aprovados elegíveis.',
    'Pro: R$ 129 por mês + 0,50% sobre pagamentos online aprovados elegíveis.',
    'Premium: R$ 249 por mês + 0,20% sobre pagamentos online aprovados elegíveis.',
    'Não há taxa de implantação nem add-on obrigatório no catálogo padrão desta versão.',
    'Tarifas cobradas pelo provedor de pagamento são separadas da taxa KÔMA.',
    'O catálogo vigente orienta novas contratações. Valores e percentuais já aceitos por um contratante permanecem vinculados ao respectivo comprovante até mudança expressa de contratação ou novo aceite aplicável.',
  ],
};

const COMMERCIAL_ANNUAL: LegalSection = {
  title: '5. Modalidade anual',
  paragraphs: [
    'Para Pocket, Pro e Premium, a modalidade anual aplica 10% de desconto exclusivamente ao componente fixo. Valores desta versão: Pocket R$ 421,20 por ano, equivalente a R$ 35,10 por mês; Pro R$ 1.393,20 por ano, equivalente a R$ 116,10 por mês; Premium R$ 2.689,20 por ano, equivalente a R$ 224,10 por mês.',
    'A taxa percentual sobre pagamentos online não recebe desconto anual e permanece no percentual contratado do plano.',
    'O valor mensal equivalente é apenas referência comparativa do componente fixo anual. As condições do meio de pagamento e da renovação são apresentadas na contratação.',
  ],
};

const COMMERCIAL_PAYMENT_METHODS: LegalSection = {
  title: '6. Métodos de pagamento da assinatura',
  paragraphs: [
    'O Pocket desta versão possui componente fixo de R$ 39,00 por mês. O checkout apresenta os meios de pagamento disponíveis para esse componente.',
    'Quando houver componente fixo, o checkout KÔMA pode publicar cartão de crédito, Pix por QR Code e Pix Copia e Cola e Saldo Mercado Pago (account_money), sujeitos à disponibilidade e às capacidades publicadas pelo backend.',
    'Cartão e Saldo Mercado Pago podem usar autorização recorrente. Pix é cobrança interoperável independente, pagável em qualquer banco ou PSP compatível com Pix, e não deve ser apresentado como Pix Automático.',
    'A conexão Mercado Pago OAuth do restaurante para receber pagamentos de seus clientes é independente do meio usado para pagar a mensalidade SaaS.',
  ],
};

const COMMERCIAL_TRIAL: LegalSection = {
  title: '7. Teste gratuito de 7 dias',
  paragraphs: [
    'O Pocket desta versão é elegível ao teste gratuito de 7 dias do componente fixo após a implantação essencial e o início explícito pelo administrador.',
    'Salvo oferta individual diferente, Pocket, Pro e Premium são elegíveis a 7 dias grátis no componente fixo após a conclusão dos quatro itens de implantação essencial e o início explícito pelo administrador no KÔMA.',
    'Pagamentos online reais processados durante eventual período de teste continuam sujeitos à taxa percentual contratada do plano e às tarifas separadas do provedor.',
    'O cancelamento da recorrência antes do fim do trial impede a primeira cobrança fixa quando houver componente fixo recorrente.',
  ],
};

const ONLINE_PAYMENT_FEE: LegalSection = {
  title: '8. Taxa sobre pagamentos online',
  paragraphs: [
    'A taxa KÔMA incide sobre o valor bruto de cada pagamento online aprovado e elegível no fluxo integrado, no percentual comercial efetivamente contratado pelo estabelecimento.',
    'O percentual aplicável a um tenant já contratado é obtido do snapshot comercial aceito e não deve ser recalculado apenas a partir do nome atual do plano ou de alterações posteriores do catálogo público.',
    'A taxa não se aplica automaticamente a dinheiro, cartão presencial, Pix externo ou outras formas processadas fora do fluxo online elegível.',
    'Quando disponível, a divisão pode ocorrer automaticamente pelo provedor. Reembolsos e chargebacks seguem também as regras técnicas e financeiras do provedor.',
  ],
};

const PLAN_CHANGES: LegalSection = {
  title: '9. Upgrade, downgrade e alterações do catálogo',
  paragraphs: [
    'Mudanças de plano que alterem preço fixo, taxa transacional ou outras condições comerciais exigem fluxo explícito de alteração, com confirmação dos novos termos quando aplicável. A simples edição administrativa do nome do plano não substitui esse processo.',
    'O KÔMA não realiza upgrade automático de plano com base em volume de vendas ou GMV nesta versão.',
    'Contratos existentes preservam os valores, percentuais, versão jurídica e evidências aceitos até que exista migração, nova contratação ou novo aceite válido para substituí-los.',
    'Alteração extraordinária de preço ou redução material de recurso será comunicada com antecedência razoável, permitindo cancelamento antes da vigência quando aplicável.',
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

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V25_DOCUMENTS.map((document) => {
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
    current = replaceSection(current, SAAS_PAYMENT_METHODS);
    current = replaceSection(current, FREE_TRIAL_TERMS);
  }
  if (document.slug === 'planos') {
    current = replaceSection(current, COMMERCIAL_CATALOG);
    current = replaceSection(current, COMMERCIAL_ANNUAL);
    current = replaceSection(current, COMMERCIAL_PAYMENT_METHODS);
    current = replaceSection(current, COMMERCIAL_TRIAL);
    current = replaceSection(current, ONLINE_PAYMENT_FEE);
    current = replaceSection(current, PLAN_CHANGES);
  }
  return current;
});

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug);
}
