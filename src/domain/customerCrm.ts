import type { LoyaltyCustomer } from '../components/caixa/cashierContracts';

export type CustomerSort = 'orders' | 'spent' | 'recent' | 'absent' | 'name';
export type CustomerSegment =
  | 'ALL'
  | 'SECOND'
  | 'BALANCE'
  | 'CADENCE'
  | 'ATIVO'
  | 'REPEAT'
  | 'ATENCAO'
  | 'REATIVAR'
  | 'SEM_COMPRA'
  | 'SECOND_PURCHASE'
  | 'CADENCE_RECOVERY'
  | 'BENEFIT_REMINDER'
  | 'VIP_RECOGNITION'
  | 'OCCURRENCE_RECOVERY';

export type CrmRecencyFilter = 'ALL' | 'ATE_15' | '16_30' | '31_60' | 'MAIS_60' | 'SEM_COMPRA';
export type CrmFrequencyFilter = 'ALL' | 'SEM_COMPRA' | 'UMA_COMPRA' | 'RECORRENTE_2_3' | 'FREQUENTE_4_MAIS';
export type CrmValueFilter = 'ALL' | 'ATE_100' | '100_300' | 'MAIS_300';
export type CrmBenefitFilter = 'ALL' | 'RESGATAVEL' | 'SALDO_EM_FORMACAO' | 'SEM_SALDO';
export type CrmContactFilter = 'ALL' | 'DISPONIVEL_ABORDAGEM' | 'CONTATO_RECENTE' | 'OPT_OUT' | 'VOLTOU_APOS_CONTATO';

export interface CrmCustomerFilterOptions {
  search?: string;
  segment?: CustomerSegment;
  sort?: CustomerSort;
  recency?: CrmRecencyFilter;
  frequency?: CrmFrequencyFilter;
  valueBand?: CrmValueFilter;
  productQuery?: string;
  benefitStatus?: CrmBenefitFilter;
  contactStatus?: CrmContactFilter;
}

export const customerSegmentLabel = (customer: LoyaltyCustomer) => ({
  ATIVO: 'Ativo', ATENCAO: 'Atenção', REATIVAR: 'Reativar', SEM_COMPRA: 'Sem compra',
}[customer.segmento_relacionamento || 'SEM_COMPRA']);

export function selectCrmCustomers(customers: LoyaltyCustomer[], search: string, segment: CustomerSegment, sort: CustomerSort) {
  const term = search.trim().toLocaleLowerCase('pt-BR');
  const digits = term.replace(/\D/g, '');
  return customers.filter(customer => {
    const matchesSearch = !term || `${customer.cliente} ${customer.telefone}`.toLocaleLowerCase('pt-BR').includes(term)
      || (digits.length > 0 && /^[\d\s()+-]+$/.test(term) && customer.telefone.replace(/\D/g, '').includes(digits));
    const matchesSegment = matchesCustomerSegment(customer, segment);
    return matchesSearch && matchesSegment;
  }).sort((a, b) => {
    let difference = 0;
    if (sort === 'orders') difference = (b.pedidos_concluidos ?? 0) - (a.pedidos_concluidos ?? 0) || (b.valor_pago_total ?? 0) - (a.valor_pago_total ?? 0);
    if (sort === 'spent') difference = (b.valor_pago_total ?? 0) - (a.valor_pago_total ?? 0);
    if (sort === 'recent') difference = (a.dias_sem_comprar ?? Infinity) - (b.dias_sem_comprar ?? Infinity);
    if (sort === 'absent') difference = (b.dias_sem_comprar ?? -1) - (a.dias_sem_comprar ?? -1);
    return (Number.isNaN(difference) ? 0 : difference) || a.cliente.localeCompare(b.cliente, 'pt-BR') || a.id.localeCompare(b.id);
  });
}

export function matchesCustomerSegment(customer: LoyaltyCustomer, segment: CustomerSegment): boolean {
  const count = customer.pedidos_concluidos ?? 0;
  const days = customer.dias_sem_comprar;
  if (segment === 'ALL') return true;
  if (segment === 'REPEAT') return count >= 2;
  if (segment === 'SECOND' || segment === 'SECOND_PURCHASE') return count === 1 && days != null && days >= 6 && days <= 30;
  if (segment === 'BALANCE') return count > 0 && days != null && days > 30 && (customer.pontos > 0 || customer.saldoCashback > 0);
  if (segment === 'BENEFIT_REMINDER') return count >= 1 && Boolean(customer.elegivel_resgate) && days != null && days >= 10;
  const interval = customer.intervalo_medio_dias ?? 0;
  if (segment === 'CADENCE' || segment === 'CADENCE_RECOVERY') return count >= 3 && days != null && interval >= 1 && days > Math.max(7, interval * 1.5);
  if (segment === 'VIP_RECOGNITION') return count >= 4 && days != null && days <= 45;
  if (segment === 'OCCURRENCE_RECOVERY') return Boolean(customer.ocorrencia_aberta) && !customer.voltou_apos_ultimo_contato;
  return (customer.segmento_relacionamento || 'SEM_COMPRA') === segment;
}

export function filterCrmCustomersAdvanced(customers: LoyaltyCustomer[], options: CrmCustomerFilterOptions): LoyaltyCustomer[] {
  const base = selectCrmCustomers(
    customers,
    options.search || '',
    options.segment || 'ALL',
    options.sort || 'orders',
  );
  const recency = options.recency || 'ALL';
  const frequency = options.frequency || 'ALL';
  const valueBand = options.valueBand || 'ALL';
  const productQuery = (options.productQuery || '').trim().toLocaleLowerCase('pt-BR');
  const benefitStatus = options.benefitStatus || 'ALL';
  const contactStatus = options.contactStatus || 'ALL';

  return base.filter((customer) => {
    const days = customer.dias_sem_comprar;
    const count = customer.pedidos_concluidos ?? 0;
    const total = customer.valor_pago_total ?? 0;

    if (recency === 'SEM_COMPRA' && (count > 0 || days !== null)) return false;
    if (recency === 'ATE_15' && (days === null || days === undefined || days > 15)) return false;
    if (recency === '16_30' && (days === null || days === undefined || days < 16 || days > 30)) return false;
    if (recency === '31_60' && (days === null || days === undefined || days < 31 || days > 60)) return false;
    if (recency === 'MAIS_60' && (days === null || days === undefined || days <= 60)) return false;

    if (frequency === 'SEM_COMPRA' && count !== 0) return false;
    if (frequency === 'UMA_COMPRA' && count !== 1) return false;
    if (frequency === 'RECORRENTE_2_3' && (count < 2 || count > 3)) return false;
    if (frequency === 'FREQUENTE_4_MAIS' && count < 4) return false;

    if (valueBand === 'ATE_100' && (count === 0 || total > 100)) return false;
    if (valueBand === '100_300' && (total <= 100 || total > 300)) return false;
    if (valueBand === 'MAIS_300' && total <= 300) return false;

    if (productQuery) {
      const favs = customer.produtos_favoritos || [];
      const hasProduct = favs.some(
        (p) =>
          String(p.produto_id).toLocaleLowerCase('pt-BR') === productQuery ||
          p.nome.toLocaleLowerCase('pt-BR').includes(productQuery),
      );
      if (!hasProduct) return false;
    }

    if (benefitStatus !== 'ALL') {
      const computedStatus =
        customer.status_beneficio ||
        (customer.elegivel_resgate
          ? 'RESGATAVEL'
          : (customer.pontos || 0) > 0 || (customer.saldoCashback || 0) > 0
          ? 'SALDO_EM_FORMACAO'
          : 'SEM_SALDO');
      if (computedStatus !== benefitStatus) return false;
    }

    if (contactStatus === 'DISPONIVEL_ABORDAGEM') {
      if (customer.opt_out_marketing || customer.contato_recente || customer.telefone_valido_whatsapp === false) return false;
    } else if (contactStatus === 'CONTATO_RECENTE') {
      if (!customer.contato_recente) return false;
    } else if (contactStatus === 'OPT_OUT') {
      if (!customer.opt_out_marketing) return false;
    } else if (contactStatus === 'VOLTOU_APOS_CONTATO') {
      if (!customer.voltou_apos_ultimo_contato) return false;
    }

    return true;
  });
}

export function interpolateCrmTemplate(
  template: string,
  customer: Partial<LoyaltyCustomer>,
  benefitOverride?: string,
): string {
  const rawName = (customer.nome || customer.cliente || '').trim();
  const firstName =
    rawName && rawName.toLocaleLowerCase('pt-BR') !== 'cliente'
      ? rawName.split(/\s+/)[0]
      : '';
  const safeName = firstName || 'tudo bem';

  const topProduct = customer.produtos_favoritos?.[0]?.nome?.trim();
  const safeProduct = topProduct || 'seu prato preferido da casa';

  const rawBenefit =
    (benefitOverride && benefitOverride.trim()) ||
    (customer.elegivel_resgate && customer.beneficio_disponivel ? customer.beneficio_disponivel.trim() : '');
  const safeBenefit = rawBenefit || 'uma condição especial para o seu próximo pedido';

  let out = template;
  if (!firstName) {
    out = out.replace(/Oi,\s*\{nome\}!/gi, 'Oi, tudo bem?');
    out = out.replace(/Olá,\s*\{nome\}!/gi, 'Olá, tudo bem?');
  }
  return out
    .replace(/\{nome\}/gi, safeName)
    .replace(/\{produto_favorito\}/gi, safeProduct)
    .replace(/\{beneficio\}/gi, safeBenefit);
}

export function buildManualWhatsAppUrl(telefone?: string | null, mensagem?: string): string | null {
  if (!telefone) return null;
  let digits = String(telefone).replace(/\D/g, '');
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return null;
  const ddd = Number(digits.slice(0, 2));
  if (Number.isNaN(ddd) || ddd < 11 || ddd > 99) return null;
  if (new Set(digits.slice(2).split('')).size <= 1) return null;
  const query = mensagem ? `?text=${encodeURIComponent(mensagem)}` : '';
  return `https://wa.me/55${digits}${query}`;
}

export const DEFAULT_CRM_TEMPLATES: Record<
  string,
  { label: string; semDesconto: string; comBeneficio: string }
> = {
  SECOND_PURCHASE: {
    label: 'Incentivar a 2ª compra',
    semDesconto:
      'Oi, {nome}! Gostou do seu primeiro pedido aqui com a gente? Quando bater a vontade de pedir {produto_favorito} novamente, estamos prontos por aqui.',
    comBeneficio:
      'Oi, {nome}! Queremos muito te ver de novo após seu primeiro pedido. Preparamos {beneficio} para você pedir {produto_favorito} nesta semana.',
  },
  CADENCE_RECOVERY: {
    label: 'Recuperar recorrentes fora do ritmo',
    semDesconto:
      'Oi, {nome}! Sentimos sua falta por aqui. Seu {produto_favorito} continua saindo caprichado — quando quiser pedir, é só chamar.',
    comBeneficio:
      'Oi, {nome}! Faz alguns dias que você não pede seu {produto_favorito}. Separamos {beneficio} para o seu retorno!',
  },
  BENEFIT_REMINDER: {
    label: 'Lembrar benefício disponível',
    semDesconto:
      'Oi, {nome}! Passando para lembrar que você já tem {beneficio} disponível na sua conta para usar quando pedir {produto_favorito}.',
    comBeneficio:
      'Oi, {nome}! Você tem {beneficio} pronto para resgate aqui no restaurante. Aproveite no seu próximo pedido de {produto_favorito}!',
  },
  VIP_RECOGNITION: {
    label: 'Reconhecer clientes frequentes',
    semDesconto:
      'Oi, {nome}! Obrigado por ser cliente frequente da nossa casa. Sempre que pedir {produto_favorito}, conte com nosso cuidado especial!',
    comBeneficio:
      'Oi, {nome}! Obrigado pela parceria de sempre. Como reconhecimento pela sua frequência, liberamos {beneficio} para você aproveitar com {produto_favorito}.',
  },
  OCCURRENCE_RECOVERY: {
    label: 'Retomar relacionamento após ocorrência',
    semDesconto:
      'Oi, {nome}! Vimos sua última avaliação e revisamos nosso processo internamente. Queremos garantir uma experiência impecável no seu próximo pedido.',
    comBeneficio:
      'Oi, {nome}! Agradecemos seu feedback sincero e já corrigimos o que aconteceu. Deixamos {beneficio} registrado para cuidarmos pessoalmente do seu próximo pedido.',
  },
};

export const customerOpportunityRules = [
  { segment: 'SECOND', label: 'Incentivar a 2ª compra', explanation: 'Uma compra concluída e de 6 a 30 dias sem voltar.' },
  { segment: 'BALANCE', label: 'Benefício parado', explanation: 'Já comprou, tem pontos ou cashback e não volta há mais de 30 dias. Confira a regra do programa antes de oferecer resgate.' },
  { segment: 'CADENCE', label: 'Fora do ritmo habitual', explanation: 'Ao menos 3 compras, intervalo médio de 1 dia ou mais e ausência acima de 1,5 vez esse intervalo (mínimo de 7 dias). Indício para revisar, não previsão.' },
] as const;
