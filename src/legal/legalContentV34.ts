import {
  LEGAL_DOCUMENTS as LEGAL_V33_DOCUMENTS,
  LEGAL_PROVIDER_LOCATION,
  LEGAL_PROVIDER_NAME,
  LEGAL_SUPPORT_SCHEDULE,
  type LegalDocument,
  type LegalDocumentSlug,
  type LegalSection,
} from './legalContentV33';

export type { LegalDocument, LegalDocumentSlug, LegalSection };
export { LEGAL_PROVIDER_LOCATION, LEGAL_PROVIDER_NAME, LEGAL_SUPPORT_SCHEDULE };

export const LEGAL_VERSION = '3.4';
export const LEGAL_EFFECTIVE_DATE = '10/10/2026';

// Texto congelado desta versão; não consultar o catálogo mutável em runtime.
const updatedCommercialTerms = new Map<string, string>([
  ["A contratação do Pocket desta versão tem mensalidade fixa de R$ 39,00 e exige seleção de meio de pagamento disponível. Contratos anteriores com mensalidade fixa de R$ 0 preservam seus termos aceitos e não criam recorrência de valor zero no provedor.",
   "A contratação do Pocket desta versão tem mensalidade fixa de R$ 79,90 e exige seleção de meio de pagamento disponível. Contratos anteriores com mensalidade fixa de R$ 0 preservam seus termos aceitos e não criam recorrência de valor zero no provedor."],
  ["Durante o uso do sistema, pagamentos online reais e elegíveis podem gerar a taxa percentual contratada do plano e tarifas separadas do respectivo provedor. O trial, quando aplicável, alcança somente o componente fixo.",
   "Nesta versão, a comissão KÔMA sobre pedidos online é 0% nos três planos, inclusive durante o teste. Tarifas de terceiros permanecem separadas e são pagas pelo estabelecimento diretamente ao provedor conectado. O trial alcança somente o componente fixo."],
  ["Pocket: R$ 39,00 por mês + 1,79% sobre pagamentos online aprovados elegíveis.",
   "Pocket: R$ 79,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis."],
  ["Pro: R$ 129 por mês + 0,50% sobre pagamentos online aprovados elegíveis.",
   "Pro: R$ 179,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis."],
  ["Premium: R$ 249 por mês + 0,20% sobre pagamentos online aprovados elegíveis.",
   "Premium: R$ 329,90 por mês + 0% de comissão KÔMA sobre pagamentos online aprovados elegíveis."],
  ["Tarifas cobradas pelo provedor de pagamento são separadas da taxa KÔMA.",
   "Tarifas de gateways, adquirentes e Mercado Pago permanecem separadas e são pagas pelo estabelecimento diretamente ao provedor conectado."],
  ["Para Pocket, Pro e Premium, a modalidade anual aplica 10% de desconto exclusivamente ao componente fixo. Valores desta versão: Pocket R$ 421,20 por ano, equivalente a R$ 35,10 por mês; Pro R$ 1.393,20 por ano, equivalente a R$ 116,10 por mês; Premium R$ 2.689,20 por ano, equivalente a R$ 224,10 por mês.",
   "Para Pocket, Pro e Premium, a modalidade anual aplica 10% de desconto exclusivamente ao componente fixo. Valores desta versão: Pocket R$ 862,92 por ano, equivalente a R$ 71,91 por mês; Pro R$ 1.942,92 por ano, equivalente a R$ 161,91 por mês; Premium R$ 3.562,92 por ano, equivalente a R$ 296,91 por mês."],
  ["A taxa percentual sobre pagamentos online não recebe desconto anual e permanece no percentual contratado do plano.",
   "Na modalidade anual desta versão, a comissão KÔMA sobre pedidos online permanece em 0% nos três planos. O desconto de 10% incide exclusivamente sobre o componente fixo."],
  ["O Pocket desta versão possui componente fixo de R$ 39,00 por mês. O checkout apresenta os meios de pagamento disponíveis para esse componente.",
   "O Pocket desta versão possui componente fixo de R$ 79,90 por mês. O checkout apresenta os meios de pagamento disponíveis para esse componente."],
  ["Pagamentos online reais processados durante eventual período de teste continuam sujeitos à taxa percentual contratada do plano e às tarifas separadas do provedor.",
   "Durante o teste, a comissão KÔMA sobre pedidos online é 0% nos três planos. Tarifas de terceiros permanecem separadas e são pagas pelo estabelecimento diretamente ao provedor conectado."],
  ["A taxa KÔMA incide sobre o valor bruto de cada pagamento online aprovado e elegível no fluxo integrado, no percentual comercial efetivamente contratado pelo estabelecimento.",
   "Para novas contratações desta versão, a comissão KÔMA sobre pedidos online é 0% nos planos Pocket, Pro e Premium. Contratos anteriores preservam os percentuais registrados nos respectivos snapshots comerciais aceitos, mas os pagamentos futuros também recebem isenção integral de comissão KÔMA enquanto vigente a política de comissão zero. A isenção não altera mensalidades, comprovantes ou pagamentos anteriores."],
  ["Quando disponível, a divisão pode ocorrer automaticamente pelo provedor. Reembolsos e chargebacks seguem também as regras técnicas e financeiras do provedor.",
   "Com a política de comissão zero, não há retenção ou split de comissão KÔMA nos novos pagamentos online. Tarifas, reembolsos e chargebacks do provedor permanecem sujeitos às condições do provedor."],
]);

export const LEGAL_DOCUMENTS: LegalDocument[] = LEGAL_V33_DOCUMENTS.map(document => ({
  ...document,
  version: LEGAL_VERSION,
  effectiveDate: LEGAL_EFFECTIVE_DATE,
  sections: document.sections.map(section => ({
    ...section,
    paragraphs: section.paragraphs?.map(text => updatedCommercialTerms.get(text) ?? text),
    bullets: section.bullets?.map(text => updatedCommercialTerms.get(text) ?? text),
  })),
}));

export function findLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find(document => document.slug === slug);
}
