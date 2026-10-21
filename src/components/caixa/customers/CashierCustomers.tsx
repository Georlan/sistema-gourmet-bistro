import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Filter,
  Gift,
  Plus,
  Search,
  Sparkles,
  Ticket,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aplicarMascaraTelefoneInput } from '../../../utils/phonePresentation';
import {
  customerOpportunityRules,
  customerSegmentLabel,
  filterCrmCustomersAdvanced,
  matchesCustomerSegment,
  selectCrmCustomers,
  type CrmBenefitFilter,
  type CrmContactFilter,
  type CrmFrequencyFilter,
  type CrmRecencyFilter,
  type CrmValueFilter,
  type CustomerSegment,
  type CustomerSort,
} from '../../../domain/customerCrm';
import CuponsTab, { type CupomData } from '../../clientes/CuponsTab';
import type { GrowthEconomicsOption } from '../../clientes/GrowthEconomicsCalculator';
import MoneyInput from '../../MoneyInput';
import { KomaEmptyState } from '../../shared/KomaEmptyState';
import { OperationalBanner } from '../../shared/OperationalBanner';
import type { CashierNotice, LoyaltyCustomer } from '../cashierContracts';
import { CustomerCampaignsWorkspace, type CrmCampaignDraftSeed } from './CustomerCampaignsWorkspace';
import { CustomerHabits } from './CustomerHabits';
import { CustomerProfileDrawer } from './CustomerProfileDrawer';
import { CustomerRelationshipPanel } from './CustomerRelationshipPanel';
import { LoyaltyProgramPanel } from './LoyaltyProgramPanel';
import { DEFAULT_LOYALTY_CONFIG, useLoyaltyConfiguration } from './useLoyaltyConfiguration';
import { CustomerResultsWorkspace } from './CustomerResultsWorkspace';
import { CustomerSatisfactionPanel } from './CustomerSatisfactionPanel';
import { useCustomerSatisfaction } from './useCustomerSatisfaction';
import { mapCustomers } from './useCashierCustomers';

const formatarTelefoneTabela = (tel?: string) => {
  if (!tel) return '-';
  const limpo = tel.replace(/\D/g, '');
  if (limpo.length === 11) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 7)}-${limpo.slice(7)}`;
  } else if (limpo.length === 10) {
    return `(${limpo.slice(0, 2)}) ${limpo.slice(2, 6)}-${limpo.slice(6)}`;
  }
  return tel;
};

const ultimaCompraLabel = (dias?: number | null) => {
  if (dias === null || dias === undefined) return 'Sem compra identificada';
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  return `há ${dias} dias`;
};

export type CrmWorkspaceTab = 'oportunidades' | 'clientes' | 'campanhas' | 'beneficios' | 'resultados';

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  loyaltyUsers: LoyaltyCustomer[];
  customersStatus: 'loading' | 'ready' | 'refreshing' | 'error';
  hasCustomerSnapshot: boolean;
  refreshLoyaltyUsers: () => Promise<void>;
  totalCustomers: number;
  hasMoreCustomers: boolean;
  loadingMoreCustomers: boolean;
  loadMoreCustomers: () => Promise<void>;
  hasLoyalty: boolean;
  hasCoupons: boolean;
}

export default function CashierCustomers({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveSubTab,
  showToast,
  loyaltyUsers,
  customersStatus,
  hasCustomerSnapshot,
  refreshLoyaltyUsers,
  totalCustomers,
  hasMoreCustomers,
  loadingMoreCustomers,
  loadMoreCustomers,
  hasLoyalty,
  hasCoupons,
}: Props) {
  // Seleção única para o menu lateral e a barra horizontal compartilhada.
  const beneficiosSection = ['cupons', 'cupom', 'promocoes', 'descontos'].includes(activeSubTab) || (!hasLoyalty && hasCoupons) ? 'cupons' : 'fidelidade';
  const crmTab: CrmWorkspaceTab = ['fidelidade', 'cupons', 'cupom', 'promocoes', 'descontos', 'beneficios'].includes(activeSubTab)
    ? 'beneficios'
    : ['clientes', 'campanhas', 'resultados'].includes(activeSubTab)
      ? activeSubTab as CrmWorkspaceTab : 'oportunidades';
  const handleSelectCrmTab = (nextTab: CrmWorkspaceTab) => {
    setActiveSubTab(nextTab === 'beneficios' ? (hasLoyalty ? 'fidelidade' : 'cupons') : nextTab);
  };

  // Keep editable CRM subtrees mounted after first visit. Navigation must not erase drafts.
  const [visitedRelationship, setVisitedRelationship] = useState(activeTab === 'clientes');
  const [visitedCampaigns, setVisitedCampaigns] = useState(false);
  const [visitedBenefits, setVisitedBenefits] = useState(false);
  const [visitedFidelity, setVisitedFidelity] = useState(false);
  const [visitedCoupons, setVisitedCoupons] = useState(false);
  useEffect(() => {
    if (activeTab !== 'clientes') return;
    setVisitedRelationship(true);
    if (crmTab === 'campanhas') setVisitedCampaigns(true);
    if (crmTab === 'beneficios') {
      setVisitedBenefits(true);
      if (beneficiosSection === 'fidelidade') setVisitedFidelity(true);
      if (beneficiosSection === 'cupons') setVisitedCoupons(true);
    }
  }, [activeTab, crmTab, beneficiosSection]);

  // Busca e filtros da aba Clientes
  const [clientesSearch, setClientesSearch] = useState('');
  const searchTerm = clientesSearch.trim();
  const [customerSort, setCustomerSort] = useState<CustomerSort>('orders');
  const activeSearch = Boolean(searchTerm) || customerSort !== 'orders';
  const searchKey = `${customerSort}\u0000${searchTerm}`;
  const searchGeneration = useRef(0);
  const [searchRetry, setSearchRetry] = useState(0);
  const [searchResult, setSearchResult] = useState<{
    query: string; scope: string; data: LoyaltyCustomer[]; total: number;
    hasMore: boolean; loading: boolean; error: string | null;
  } | null>(null);
  const searchScope = `${apiBaseUrl}\u0000${authHeaders.Authorization || authHeaders.authorization || ''}`;
  useEffect(() => {
    searchGeneration.current += 1;
    if (!activeSearch || crmTab !== 'clientes') { setSearchResult(null); return; }
    const controller = new AbortController();
    setSearchResult(current => current?.query === searchKey && current.scope === searchScope
      ? { ...current, loading: true, error: null }
      : { query: searchKey, scope: searchScope, data: [], total: 0, hasMore: false, loading: true, error: null });
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: searchTerm, sort: customerSort, limit: '100', offset: '0' });
        const res = await fetch(`${apiBaseUrl}/fidelidade/clientes?${params}`, { headers: authHeaders, signal: controller.signal });
        if (!res.ok) throw new Error(`Falha na pesquisa (${res.status})`);
        const payload = await res.json();
        if (!Array.isArray(payload)) throw new Error('Pesquisa retornou dados inválidos');
        if (!controller.signal.aborted) setSearchResult({
          query: searchKey, scope: searchScope,
          data: mapCustomers(payload, res.headers.get('X-Products-Included') !== 'false'),
          total: Number(res.headers.get('X-Total-Count')) || payload.length,
          hasMore: res.headers.get('X-Has-More') === 'true', loading: false, error: null,
        });
      } catch (err) {
        if (!controller.signal.aborted) setSearchResult(current => current?.query === searchKey && current.scope === searchScope
          ? { ...current, loading: false, error: err instanceof Error ? err.message : 'Pesquisa indisponível' }
          : current);
      }
    }, 300);
    return () => { searchGeneration.current += 1; clearTimeout(timer); controller.abort(); };
  }, [searchKey, searchScope, crmTab, loyaltyUsers, searchRetry]);

  const queryResult = activeSearch && searchResult?.query === searchKey && searchResult.scope === searchScope ? searchResult : null;
  const listUsers = activeSearch ? (queryResult?.data ?? []) : loyaltyUsers;
  const listTotal = activeSearch ? (queryResult?.total ?? 0) : totalCustomers;
  const listHasMore = activeSearch ? Boolean(queryResult?.hasMore) : hasMoreCustomers;
  const loadNextSearchPage = async () => {
    if (!queryResult || queryResult.loading || !queryResult.hasMore) return;
    const previous = queryResult;
    const generation = searchGeneration.current;
    setSearchResult({ ...previous, loading: true });
    try {
      const params = new URLSearchParams({ q: searchTerm, sort: customerSort, limit: '100', offset: String(previous.data.length) });
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes?${params}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`Falha na próxima página (${res.status})`);
      const payload = await res.json();
      if (!Array.isArray(payload)) throw new Error('Página inválida');
      setSearchResult(current => {
        if (generation !== searchGeneration.current || !current || current.query !== previous.query || current.scope !== previous.scope) return current;
        const already = new Set(current.data.map(c => c.id));
        const more = mapCustomers(payload, res.headers.get('X-Products-Included') !== 'false').filter(c => !already.has(c.id));
        return { ...current, data: [...current.data, ...more],
          total: Number(res.headers.get('X-Total-Count')) || current.total,
          hasMore: res.headers.get('X-Has-More') === 'true', loading: false, error: null };
      });
    } catch (err) {
      setSearchResult(current => generation === searchGeneration.current && current?.query === previous.query && current.scope === previous.scope
        ? { ...current, loading: false, error: err instanceof Error ? err.message : 'Falha na próxima página' } : current);
    }
  };
  const [customerSegment, setCustomerSegment] = useState<CustomerSegment>('ALL');
  const [recencyFilter, setRecencyFilter] = useState<CrmRecencyFilter>('ALL');
  const [frequencyFilter, setFrequencyFilter] = useState<CrmFrequencyFilter>('ALL');
  const [valueFilter, setValueFilter] = useState<CrmValueFilter>('ALL');
  const [productQuery, setProductQuery] = useState('');
  const [favoriteSnapshot, setFavoriteSnapshot] = useState<{
    scope: string; byCustomerId: Record<string, LoyaltyCustomer['produtos_favoritos']>;
    loading: boolean; error: string | null;
  }>({ scope: searchScope, byCustomerId: {}, loading: false, error: null });
  const [favoriteRetry, setFavoriteRetry] = useState(0);
  const favoriteData = favoriteSnapshot.scope === searchScope ? favoriteSnapshot.byCustomerId : {};
  const filteredSourceUsers = useMemo(
    () => listUsers.map(user => Object.prototype.hasOwnProperty.call(favoriteData, user.id)
      ? { ...user, produtos_favoritos: favoriteData[user.id] } : user),
    [listUsers, favoriteData],
  );
  useEffect(() => {
    if (!productQuery.trim() || !listUsers.length) return;
    const known = favoriteSnapshot.scope === searchScope ? favoriteSnapshot.byCustomerId : {};
    const unknown = listUsers.filter(user => !Object.prototype.hasOwnProperty.call(known, user.id));
    if (!unknown.length || (favoriteSnapshot.scope === searchScope && (favoriteSnapshot.loading || favoriteSnapshot.error))) return;
    const controller = new AbortController();
    setFavoriteSnapshot(previous => ({
      scope: searchScope, byCustomerId: previous.scope === searchScope ? previous.byCustomerId : {},
      loading: true, error: null,
    }));
    (async () => {
      try {
        const additions: Record<string, LoyaltyCustomer['produtos_favoritos']> = {};
        for (let i = 0; i < unknown.length; i += 100) {
          const ids = unknown.slice(i, i + 100).map(customer => customer.id);
          const params = new URLSearchParams({ ids: ids.join(','), include_products: 'true', limit: '100' });
          const res = await fetch(`${apiBaseUrl}/fidelidade/clientes?${params}`, { headers: authHeaders, signal: controller.signal });
          if (!res.ok) throw new Error(`Falha ao consultar produtos (${res.status})`);
          const payload = await res.json();
          if (!Array.isArray(payload)) throw new Error('Resposta inválida de produtos');
          for (const customer of payload) {
            if (customer?.id) additions[String(customer.id)] = Array.isArray(customer.produtos_favoritos) ? customer.produtos_favoritos : [];
          }
        }
        if (!controller.signal.aborted) setFavoriteSnapshot(previous => previous.scope === searchScope
          ? { scope: searchScope, byCustomerId: { ...previous.byCustomerId, ...additions }, loading: false, error: null } : previous);
      } catch (error) {
        if (!controller.signal.aborted) setFavoriteSnapshot(previous => previous.scope === searchScope
          ? { ...previous, loading: false, error: error instanceof Error ? error.message : 'Falha nos favoritos' } : previous);
      }
    })();
    return () => controller.abort();
  }, [productQuery, listUsers, searchScope, apiBaseUrl, favoriteRetry]);
  const [benefitFilter, setBenefitFilter] = useState<CrmBenefitFilter>('ALL');
  const [contactFilter, setContactFilter] = useState<CrmContactFilter>('ALL');

  // Ficha individual lateral (preserva filtros, busca e página ao fechar)
  const [selectedProfileCustomerId, setSelectedProfileCustomerId] = useState<string | null>(null);
  const [externalCampaignCustomer, setExternalCampaignCustomer] = useState<{ scope: string; customer: LoyaltyCustomer } | null>(null);
  const currentExternalCustomer = externalCampaignCustomer?.scope === searchScope ? externalCampaignCustomer.customer : null;
  useEffect(() => {
    setExternalCampaignCustomer(null);
    setSelectedProfileCustomerId(null);
    setCampaignDraftSeed(null);
  }, [searchScope]);
  const selectedProfileCustomer = useMemo(
    () => [...listUsers, ...loyaltyUsers, ...(currentExternalCustomer ? [currentExternalCustomer] : [])].find((u) => u.id === selectedProfileCustomerId) || null,
    [loyaltyUsers, listUsers, currentExternalCustomer, selectedProfileCustomerId],
  );

  // Rascunho para abrir Campanhas já preenchido a partir de Oportunidade, Ficha Individual ou Benefício
  const [campaignDraftSeed, setCampaignDraftSeed] = useState<CrmCampaignDraftSeed | null>(null);

  // Resumo e Resultados do CRM vindos do backend (/fidelidade/crm/resumo)
  const [crmSummary, setCrmSummary] = useState<any | null>(null);
  const [crmSummaryLoading, setCrmSummaryLoading] = useState(false);
  const [crmSummaryError, setCrmSummaryError] = useState<string | null>(null);
  const [periodoDias, setPeriodoDias] = useState(30);
  const [janelaDias, setJanelaDias] = useState(14);
  // The latest filter or explicit refresh owns the visible summary.
  const crmSummaryRequestRef = useRef(0);

  const loadCrmSummary = useCallback(async () => {
    if (activeTab !== 'clientes') return;
    const requestId = ++crmSummaryRequestRef.current;
    setCrmSummaryLoading(true);
    setCrmSummaryError(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/fidelidade/crm/resumo?periodo_dias=${periodoDias}&janela_atribuicao_dias=${janelaDias}`,
        { headers: authHeaders },
      );
      if (!res.ok) throw new Error('CRM summary unavailable');
      const data = await res.json();
      if (requestId !== crmSummaryRequestRef.current) return;
      // A malformed success response must leave the last confirmed snapshot
      // and editable workspaces intact, with the same retry path as HTTP errors.
      if (!data || typeof data !== 'object' || !Array.isArray(data.campanhas)
        || !Array.isArray(data.oportunidades) || !data.resultados
        || typeof data.resultados !== 'object' || Array.isArray(data.resultados)) {
        throw new Error('Invalid CRM summary');
      }
      setCrmSummary({...data, oportunidades: Array.isArray(data?.oportunidades) ? data.oportunidades.map((op: any) => ({
        ...op, elegiveis_ids: op.elegiveis_cliente_ids ?? op.elegiveis_ids ?? [],
        motivo_entrada: op.por_que_entraram ?? op.motivo_entrada ?? '',
      })) : []});
    } catch {
      if (requestId === crmSummaryRequestRef.current) {
        setCrmSummaryError('Não foi possível atualizar os indicadores consolidados do CRM.');
      }
    } finally {
      if (requestId === crmSummaryRequestRef.current) setCrmSummaryLoading(false);
    }
  }, [activeTab, apiBaseUrl, authHeaders.Authorization, periodoDias, janelaDias]);

  useEffect(() => {
    void loadCrmSummary();
    return () => { crmSummaryRequestRef.current += 1; };
  }, [loadCrmSummary]);

  const hasAdvancedFilters =
    recencyFilter !== 'ALL' ||
    frequencyFilter !== 'ALL' ||
    valueFilter !== 'ALL' ||
    productQuery.trim() !== '' ||
    benefitFilter !== 'ALL' ||
    contactFilter !== 'ALL';

  const activeCustomerFilters = [
    customerSegment !== 'ALL',
    recencyFilter !== 'ALL',
    frequencyFilter !== 'ALL',
    valueFilter !== 'ALL',
    productQuery.trim() !== '',
    benefitFilter !== 'ALL',
    contactFilter !== 'ALL',
  ].filter(Boolean).length;

  const filteredLoyaltyUsers = useMemo(() => {
    if (!hasAdvancedFilters) {
      return selectCrmCustomers(filteredSourceUsers, activeSearch ? '' : clientesSearch, customerSegment, customerSort);
    }
    return filterCrmCustomersAdvanced(filteredSourceUsers, {
      search: activeSearch ? '' : clientesSearch,
      segment: customerSegment,
      sort: customerSort,
      recency: recencyFilter,
      frequency: frequencyFilter,
      valueBand: valueFilter,
      productQuery,
      benefitStatus: benefitFilter,
      contactStatus: contactFilter,
    });
  }, [
    filteredSourceUsers,
    clientesSearch,
    activeSearch,
    customerSegment,
    customerSort,
    hasAdvancedFilters,
    recencyFilter,
    frequencyFilter,
    valueFilter,
    productQuery,
    benefitFilter,
    contactFilter,
  ]);

  const [customerPage, setCustomerPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => {
    setCustomerPage(1);
  }, [
    clientesSearch,
    customerSegment,
    customerSort,
    recencyFilter,
    frequencyFilter,
    valueFilter,
    productQuery,
    benefitFilter,
    contactFilter,
    pageSize,
    authHeaders.Authorization,
  ]);

  const pageCount = Math.max(1, Math.ceil(filteredLoyaltyUsers.length / pageSize));
  const currentPage = Math.min(customerPage, pageCount);
  const pageCustomers = filteredLoyaltyUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const showFavoriteColumn = pageCustomers.some(customer => customer.produtos_favoritos !== undefined);
  const money = (value?: number) => (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const relationshipSummary = useMemo(() => {
    let ativos = 0;
    let atencao = 0;
    let reativar = 0;
    let semCompra = 0;
    let resgataveis = 0;
    let emFormacao = 0;
    for (const u of loyaltyUsers) {
      const seg = u.segmento_relacionamento || 'SEM_COMPRA';
      if (seg === 'ATIVO') ativos++;
      else if (seg === 'ATENCAO') atencao++;
      else if (seg === 'REATIVAR') reativar++;
      else semCompra++;

      if (u.elegivel_resgate || u.status_beneficio === 'RESGATAVEL') resgataveis++;
      else if (u.status_beneficio === 'SALDO_EM_FORMACAO' || (u.pontos > 0 && !u.elegivel_resgate)) emFormacao++;
    }
    return { ativos, atencao, reativar, semCompra, resgataveis, emFormacao };
  }, [loyaltyUsers]);

  // Catálogo das 5 Oportunidades Priorizadas (usa backend quando disponível ou cálculo determinístico local)
  const opportunitiesCatalog = useMemo(() => {
    if (Array.isArray(crmSummary?.oportunidades) && crmSummary.oportunidades.length > 0) {
      return crmSummary.oportunidades;
    }
    const eligibleFor = (seg: CustomerSegment) =>
      loyaltyUsers.filter((c) => !c.opt_out_marketing && !c.contato_recente && matchesCustomerSegment(c, seg));
    const heldRecentFor = (seg: CustomerSegment) =>
      loyaltyUsers.filter((c) => !c.opt_out_marketing && Boolean(c.contato_recente) && matchesCustomerSegment(c, seg));

    const sec = eligibleFor('SECOND_PURCHASE');
    const cad = eligibleFor('CADENCE_RECOVERY');
    const ben = eligibleFor('BENEFIT_REMINDER');
    const vip = eligibleFor('VIP_RECOGNITION');
    const occ = eligibleFor('OCCURRENCE_RECOVERY');

    return [
      {
        id: 'SECOND_PURCHASE',
        prioridade: 1,
        titulo: 'Incentivar a 2ª compra',
        elegiveis_count: sec.length,
        elegiveis_ids: sec.map((c) => c.id),
        retidos_contato_recente_count: heldRecentFor('SECOND_PURCHASE').length,
        motivo_entrada: 'Fizeram exatamente 1 compra concluída há entre 6 e 30 dias e ainda não voltaram.',
        abordagem_recomendada:
          'Convite leve sem desconto relembrando o prato pedido, ou benefício de boas-vindas se precisar destravar o segundo pedido.',
        abordagem_sem_desconto: 'Perguntar como foi a experiência no 1º pedido e sugerir o prato favorito para hoje.',
        abordagem_com_beneficio: 'Oferecer cupom de 2ª compra com valor mínimo que proteja o ticket médio.',
        criterios: '1 pedido concluído (sem cancelamento/estorno total), 6 a 30 dias desde a compra, sem contato nos últimos 7 dias.',
        limitacoes: 'Não inclui cadastros sem compra identificada nem pedidos cancelados.',
      },
      {
        id: 'CADENCE_RECOVERY',
        prioridade: 2,
        titulo: 'Recuperar recorrentes fora do ritmo habitual',
        elegiveis_count: cad.length,
        elegiveis_ids: cad.map((c) => c.id),
        retidos_contato_recente_count: heldRecentFor('CADENCE_RECOVERY').length,
        motivo_entrada: 'Têm 3 ou mais compras concluídas e passaram de 1,5x o próprio intervalo médio de recompra.',
        abordagem_recomendada: 'Abordagem pessoal lembrando o item favorito da casa antes que criem hábito em outro restaurante.',
        abordagem_sem_desconto: 'Mensagem direta lembrando o prato mais pedido e novidades do cardápio.',
        abordagem_com_beneficio: 'Cupom de retorno ou lembrete de saldo de fidelidade acumulado.',
        criterios: 'Mínimo de 3 compras concluídas, intervalo médio >= 1 dia e ausência > máx(7 dias, 1,5x intervalo médio).',
        limitacoes: 'Baseado no histórico observado no restaurante; é um sinal operacional, não previsão de churn.',
      },
      {
        id: 'BENEFIT_REMINDER',
        prioridade: 3,
        titulo: 'Lembrar benefícios disponíveis para resgate',
        elegiveis_count: ben.length,
        elegiveis_ids: ben.map((c) => c.id),
        retidos_contato_recente_count: heldRecentFor('BENEFIT_REMINDER').length,
        motivo_entrada: 'Possuem saldo de fidelidade já liberado para resgate (>= R$ 1,00) e não compram há pelo menos 10 dias.',
        abordagem_recomendada: 'Sem novo desconto: apenas avisar que já possuem saldo real disponível para abater no próximo pedido.',
        abordagem_sem_desconto: 'Lembrete transparente do saldo resgatável já conquistado pelo cliente.',
        abordagem_com_beneficio: 'Uso do próprio saldo de pontos/cashback já provisionado no programa.',
        criterios: 'Programa ativo, pelo menos 1 compra concluída, saldo equivalente >= R$ 1,00 e 10+ dias sem comprar.',
        limitacoes: 'Clientes com pontos que ainda não atingem R$ 1,00 ficam como “Saldo em formação” e não entram nesta lista.',
      },
      {
        id: 'VIP_RECOGNITION',
        prioridade: 4,
        titulo: 'Reconhecer clientes frequentes',
        elegiveis_count: vip.length,
        elegiveis_ids: vip.map((c) => c.id),
        retidos_contato_recente_count: heldRecentFor('VIP_RECOGNITION').length,
        motivo_entrada: 'Acumulam 4 ou mais compras concluídas e estiveram ativos nos últimos 45 dias.',
        abordagem_recomendada: 'Reconhecimento genuíno sem desconto (agradecimento ou sugestão do chef) para fortalecer vínculo.',
        abordagem_sem_desconto: 'Agradecer a preferência recorrente e convidar para experimentar um destaque da semana.',
        abordagem_com_beneficio: 'Mimo pontual ou destaque do saldo de fidelidade acumulado.',
        criterios: '4+ compras concluídas líquidas e última compra há no máximo 45 dias.',
        limitacoes: 'Priorize mensagens espaçadas e sem insistência comercial.',
      },
      {
        id: 'OCCURRENCE_RECOVERY',
        prioridade: 5,
        titulo: 'Retomar relacionamento após ocorrência',
        elegiveis_count: occ.length,
        elegiveis_ids: occ.map((c) => c.id),
        retidos_contato_recente_count: heldRecentFor('OCCURRENCE_RECOVERY').length,
        motivo_entrada: 'Registraram avaliação de satisfação baixa (nota 1 ou 2) e ainda não voltaram a comprar depois do ocorrido.',
        abordagem_recomendada: 'Escuta ativa e pedido de desculpas humano antes de qualquer oferta comercial.',
        abordagem_sem_desconto: 'Reconhecer a falha apontada na avaliação, explicar a correção e colocar a gerência à disposição.',
        abordagem_com_beneficio: 'Cortesia ou cupom de retratação após alinhamento com o cliente.',
        criterios: 'Avaliação registrada pelo cliente_id canônico com nota <= 2 e sem pedido concluído posterior.',
        limitacoes: 'Exibido somente quando há avaliação negativa real registrada no sistema.',
      },
    ];
  }, [crmSummary, loyaltyUsers]);

  // Authoritative snapshot is never overwritten by an unsaved suggestion or input.
  const loyalty = useLoyaltyConfiguration({
    apiBaseUrl, authHeaders, hasLoyalty, visible: activeTab === 'clientes',
  });
  const savedLoyaltyConfig = loyalty.saved;
  const fidelidadeConfig = loyalty.draft ?? DEFAULT_LOYALTY_CONFIG;
  const setFidelidadeConfig = loyalty.setDraft;
  const confirmSaveFidelidadeConfig = async () => {
    if (await loyalty.save()) {
      showToast('Programa de fidelidade atualizado e confirmado pelo servidor.');
      await refreshLoyaltyUsers();
      await loadCrmSummary();
    } else {
      showToast('O programa não foi alterado. Verifique os detalhes e tente novamente.', 'error');
    }
  };

  const handleApplyGrowthOptionToLoyalty = (option: GrowthEconomicsOption) => {
    setFidelidadeConfig((prev) => {
      if (prev.tipo_recompensa === 'CASHBACK') {
        return { ...prev, taxa_conversao: option.cashback.earn_percent };
      }
      return {
        ...prev,
        taxa_conversao: option.loyalty_points.points_per_real,
        valor_ponto_em_dinheiro: option.loyalty_points.suggested_point_value_brl,
      };
    });
    showToast('Sugestão aplicada ao programa. Revise e edite se quiser antes de salvar.');
  };

  const [editingCrmUser, setEditingCrmUser] = useState<any>(null);

  const [crmFormNome, setCrmFormNome] = useState('');

  const [crmFormTelefone, setCrmFormTelefone] = useState('');

  const [crmFormPontos, setCrmFormPontos] = useState<number>(0);

  const [crmFormCashback, setCrmFormCashback] = useState<number>(0);

  const startEditingCustomer = (user: LoyaltyCustomer) => {
    setEditingCrmUser(user);
    setCrmFormNome(user.cliente);
    setCrmFormTelefone(aplicarMascaraTelefoneInput(user.telefone));
    setCrmFormPontos(user.pontos || 0);
    setCrmFormCashback(user.saldoCashback || 0);
  };

  const [showNewCrmModal, setShowNewCrmModal] = useState(false);

  const [newCrmNome, setNewCrmNome] = useState('');

  const [newCrmTelefone, setNewCrmTelefone] = useState('');

  const [newCrmSaldo, setNewCrmSaldo] = useState<number | ''>(0);
  const isClientesTabActive = activeTab === 'clientes';
  const {
    data: satisfactionData,
    isLoading: isSatisfactionLoading,
    submitSatisfaction,
  } = useCustomerSatisfaction({
    apiBaseUrl,
    authHeaders,
    enabled: isClientesTabActive,
  });

  const [showSatisfactionModal, setShowSatisfactionModal] = useState(false);
  const [satisfactionClienteId, setSatisfactionClienteId] = useState('');
  const [satisfactionNota, setSatisfactionNota] = useState<number>(5);
  const [satisfactionComentario, setSatisfactionComentario] = useState('');
  const [isSubmittingSatisfaction, setIsSubmittingSatisfaction] = useState(false);

  const handleOpenSatisfactionModal = () => {
    setSatisfactionClienteId(loyaltyUsers[0]?.id || '');
    setSatisfactionNota(5);
    setSatisfactionComentario('');
    setShowSatisfactionModal(true);
  };

  const handleRegisterSatisfaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!satisfactionClienteId) {
      showToast('Selecione um cliente para a avaliação.', 'info');
      return;
    }
    setIsSubmittingSatisfaction(true);
    const result = await submitSatisfaction({
      cliente_id: satisfactionClienteId,
      nota: satisfactionNota,
      comentario: satisfactionComentario.trim() || undefined,
    });
    setIsSubmittingSatisfaction(false);
    if (result.success) {
      showToast('Avaliação registrada com sucesso!');
      setShowSatisfactionModal(false);
      await refreshLoyaltyUsers();
      void loadCrmSummary();
    } else {
      showToast(result.error || 'Falha ao registrar avaliação.', 'error');
    }
  };

  const handleUpdateClient = async (clienteId: string, newNome: string, newPhone: string, newSaldo?: number) => {
    try {
      const body: any = {
        cliente: newNome.trim(),
        telefone: newPhone.replace(/\D/g, ''),
      };
      if (hasLoyalty && newSaldo !== undefined && !isNaN(newSaldo)) {
        if ((savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(newSaldo);
        } else {
          body.saldo_cashback = newSaldo;
        }
      }
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes/${clienteId}`, {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast('Cliente atualizado com sucesso!');
        await refreshLoyaltyUsers();
        return true;
      } else {
        const err = await res.json();
        showToast(err.detail || 'Falha ao atualizar cliente.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro de conexão.', 'error');
    }
    return false;
  };

  const handleCreateClient = async (nome: string, telefone: string, saldoInicial: number) => {
    try {
      const body: any = {
        cliente: nome.trim(),
        telefone: telefone.replace(/\D/g, ''),
      };
      if (hasLoyalty && !isNaN(saldoInicial)) {
        if ((savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS') {
          body.saldo_pontos = Math.round(saldoInicial);
        } else {
          body.saldo_cashback = saldoInicial;
        }
      }
      const res = await fetch(`${apiBaseUrl}/fidelidade/clientes`, {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast('Cliente cadastrado com sucesso!');
        await refreshLoyaltyUsers();
        return true;
      } else {
        const err = await res.json();
        showToast(err.detail || 'Erro ao cadastrar cliente.', 'error');
      }
    } catch (e) {
      console.error(e);
      showToast('Erro de conexão.', 'error');
    }
    return false;
  };

  const handleLaunchOpportunityAction = (opp: any, approach: 'SEM_DESCONTO' | 'FIDELIDADE' | 'CUPOM' = 'SEM_DESCONTO') => {
    setCampaignDraftSeed({
      objetivo: opp.id,
      titulo: `Ação: ${opp.titulo}`,
      customerIds: Array.isArray(opp.elegiveis_ids) ? opp.elegiveis_ids : undefined,
      tipoAbordagem: approach,
    });
    handleSelectCrmTab('campanhas');
  };

  const handleOpenAudienceInClientes = (segmentId: CustomerSegment) => {
    setCustomerSegment(segmentId);
    handleSelectCrmTab('clientes');
  };

  const handleStartCampaignForSingleCustomer = (customer: LoyaltyCustomer, suggestedObjective = 'SECOND_PURCHASE') => {
    setExternalCampaignCustomer({ scope: searchScope, customer });
    setSelectedProfileCustomerId(null);
    setCampaignDraftSeed({
      objetivo: suggestedObjective,
      titulo: `Abordagem individual: ${customer.cliente}`,
      customerIds: [customer.id],
      tipoAbordagem: customer.elegivel_resgate && hasLoyalty ? 'FIDELIDADE' : 'SEM_DESCONTO',
    });
    handleSelectCrmTab('campanhas');
  };

  const handleUseCupomInCampaign = (cupom: CupomData) => {
    setCampaignDraftSeed({
      objetivo: cupom.apenas_primeira_compra ? 'SECOND_PURCHASE' : 'CADENCE_RECOVERY',
      titulo: `Campanha com cupom ${cupom.codigo}`,
      tipoAbordagem: 'CUPOM',
      cupomId: String(cupom.id),
    });
    handleSelectCrmTab('campanhas');
  };

  if (activeTab === 'clientes' && !hasCustomerSnapshot) {
    return (
      <div
        className="rounded-2xl border border-koma-border bg-koma-panel p-8 text-center"
        role={customersStatus === 'error' ? 'alert' : 'status'}
      >
        <p className="font-bold text-koma-foreground">
          {customersStatus === 'error' ? 'Não foi possível carregar os clientes' : 'Carregando clientes…'}
        </p>
        {customersStatus === 'error' && (
          <button
            type="button"
            className="koma-btn-secondary mt-4 rounded-lg px-4 py-2"
            onClick={() => void refreshLoyaltyUsers()}
          >
            Tentar novamente
          </button>
        )}
      </div>
    );
  }

  const totalActionableOpportunities = opportunitiesCatalog.reduce(
    (acc: number, item: any) => acc + Number(item.elegiveis_count || 0),
    0,
  );

  return (
    <>
      {customersStatus === 'refreshing' && <p role="status" className="text-xs text-koma-muted">Atualizando clientes…</p>}
      {customersStatus === 'error' && (
        <div role="alert" className="rounded-lg border border-amber-700 p-3 text-xs text-amber-300">
          Mostrando os últimos clientes carregados.{' '}
          <button type="button" className="underline" onClick={() => void refreshLoyaltyUsers()}>
            Tentar novamente
          </button>
        </div>
      )}

      {(activeTab === 'clientes' || visitedRelationship) && (
        <div hidden={activeTab !== 'clientes'} style={{ display: activeTab === 'clientes' ? undefined : 'none' }}
          className="space-y-4 text-left animate-fade-in [&_button]:scroll-mt-32 [&_input]:scroll-mt-32 [&_select]:scroll-mt-32 [&_summary]:scroll-mt-32">
          {/* Banner Operacional com até 4 indicadores essenciais */}
          <OperationalBanner
            id="customers-heading"
            eyebrow="RELACIONAMENTO & RECOMPRA"
            title="Relacionamento"
            accent="e recompra"
            description="Escolha quem contatar e acompanhe o retorno."
            metrics={[
              { label: totalCustomers === 1 ? 'cliente na base' : 'clientes na base', value: totalCustomers },
              {
                label: crmSummary?.oportunidades ? 'elegíveis p/ ação hoje' : 'oportunidades nos carregados',
                value: totalActionableOpportunities,
                valueClassName: 'text-emerald-600 dark:text-emerald-300',
              },
              {
                label: hasMoreCustomers ? 'ativos carregados (até 30d)' : 'ativos (até 30d)',
                value: relationshipSummary.ativos,
                valueClassName: 'text-emerald-600 dark:text-emerald-300',
              },
              {
                label: hasMoreCustomers ? 'atenção / reativar carregados' : 'em atenção / reativar',
                value: relationshipSummary.atencao + relationshipSummary.reativar,
                valueClassName: 'text-amber-600 dark:text-amber-300',
              },
            ]}
          />

          {/* =====================================================================
              ABA 1: OPORTUNIDADES (Página inicial orientada a ações)
             ===================================================================== */}
          {crmTab === 'oportunidades' && (
            <div className="space-y-4 animate-fade-in">
              {/* Barra rápida de busca e novo cliente mesmo na tela inicial */}
              <section className="koma-toolbar max-sm:!grid max-sm:!grid-cols-[minmax(0,1fr)_auto]">
                <div className="koma-toolbar__search max-sm:col-span-2 max-sm:!min-w-0">
                  <Search size={14} aria-hidden="true" />
                  <input
                    value={clientesSearch}
                    onChange={(event) => {
                      setClientesSearch(event.target.value);
                      if (event.target.value.trim()) {
                        handleSelectCrmTab('clientes');
                      }
                    }}
                    placeholder="Buscar cliente por nome ou WhatsApp na base…"
                    aria-label="Buscar clientes"
                  />
                </div>
                <div className="koma-toolbar__actions max-sm:self-end">
                  <button
                    type="button"
                    onClick={() => handleSelectCrmTab('clientes')}
                    className="koma-btn-secondary rounded-xl px-3 py-2 text-xs font-bold"
                  >
                    Abrir clientes ({totalCustomers})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewCrmNome('');
                      setNewCrmTelefone('');
                      setNewCrmSaldo(0);
                      setShowNewCrmModal(true);
                    }}
                    className="koma-btn-success"
                  >
                    <Plus size={14} /> Novo cliente
                  </button>
                </div>
              </section>

              <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-bold text-koma-foreground">
                    Quem contatar hoje
                  </h3>
                  <p className="mt-1 text-sm text-koma-muted">
                    Escolha um grupo e revise a mensagem antes de entrar em contato.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleOpenSatisfactionModal}
                  className="koma-btn-secondary shrink-0 rounded-xl px-3.5 py-2 text-xs font-bold"
                >
                  Registrar avaliação de cliente
                </button>
              </div>

              {/* Grid principal de Oportunidades (Aberto diretamente, nunca escondido em acordeão) */}
              <div className={`grid gap-3 ${opportunitiesCatalog.filter((opp: any) => opp.elegiveis_count > 0).length > 1 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 max-w-5xl'}`}>
                {opportunitiesCatalog.filter((opp: any) => opp.elegiveis_count > 0).map((opp: any) => {
                  const previewCustomers = loyaltyUsers
                    .filter((u) => (opp.elegiveis_ids || []).includes(u.id))
                    .slice(0, 4);

                  return (
                    <article
                      key={opp.id}
                      className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              Prioridade {opp.prioridade}
                            </span>
                            <h4 className="mt-1.5 text-base font-bold text-koma-foreground">{opp.titulo}</h4>
                          </div>
                          <div className="text-right shrink-0">
                            <strong className="block font-mono text-2xl font-black text-emerald-400">
                              {opp.elegiveis_count}
                            </strong>
                            <span className="text-[10px] text-koma-muted">
                              {opp.elegiveis_count === 1 ? 'cliente elegível' : 'clientes elegíveis'}
                            </span>
                          </div>
                        </div>

                        <p className="text-sm text-koma-foreground">{({
                          SECOND_PURCHASE: 'Pergunte como foi o primeiro pedido e convide para pedir novamente.',
                          CADENCE_RECOVERY: 'Convide o cliente a repetir seu prato favorito.',
                          BENEFIT_REMINDER: 'Lembre o cliente do benefício que já pode usar.',
                          VIP_RECOGNITION: 'Agradeça a preferência e apresente uma novidade da casa.',
                          OCCURRENCE_RECOVERY: 'Entenda o que aconteceu e ofereça ajuda antes de vender.',
                        } as Record<string, string>)[opp.id] || 'Revise este público e prepare um convite para voltar.'}</p>

                        {previewCustomers.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-koma-muted">
                              Público:
                            </span>
                            {previewCustomers.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => setSelectedProfileCustomerId(c.id)}
                                className="min-h-8 rounded-lg bg-koma-raised px-2.5 py-1 text-xs font-medium text-koma-foreground hover:bg-emerald-500/10 focus-visible:outline-2 focus-visible:outline-emerald-500"
                              >
                                {c.cliente}
                              </button>
                            ))}
                            {opp.elegiveis_count > previewCustomers.length && (
                              <span className="text-[10px] text-koma-muted">
                                +{opp.elegiveis_count - previewCustomers.length} mais
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-koma-muted">
                            Nenhum cliente cumpre todos os critérios desta oportunidade hoje.
                          </p>
                        )}

                        {/* Critérios e limitações acessíveis sem ocupar a tela inteira */}
                        <details className="text-sm text-koma-muted">
                          <summary className="min-h-10 cursor-pointer py-2 font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">
                            Por que este grupo?
                          </summary>
                          <div className="mt-2 space-y-1">
                            <p>{opp.motivo_entrada}</p>
                            <p>{opp.abordagem_sem_desconto || opp.abordagem_recomendada}</p>
                        {opp.retidos_contato_recente_count > 0 && (
                          <p className="text-xs text-amber-300">
                            {opp.retidos_contato_recente_count} cliente(s) deste perfil foram retidos por já terem sido abordados nos últimos 7 dias.
                          </p>
                        )}


                            {opp.abordagem_com_beneficio && <p><strong>Opção com benefício:</strong> {opp.abordagem_com_beneficio}</p>}
                            <p>
                              <strong>Como selecionamos:</strong> {opp.criterios}
                            </p>
                            <p>
                              <strong>O que considerar:</strong> {opp.limitacoes}
                            </p>
                          </div>
                        </details>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-koma-border pt-3">
                        <button
                          type="button"
                          onClick={() => handleLaunchOpportunityAction(opp, 'SEM_DESCONTO')}
                          className="koma-btn-primary flex-1 rounded-xl px-3.5 py-2 text-xs font-bold"
                        >
                          Abrir público e iniciar ação
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenAudienceInClientes(opp.id as CustomerSegment)}
                          className="koma-btn-secondary rounded-xl px-3 py-2 text-xs font-bold"
                        >
                          Ver na lista
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>

              {!crmSummaryLoading && !crmSummaryError && opportunitiesCatalog.every((opp: any) => !opp.elegiveis_count) && (
                <div className="rounded-2xl border border-koma-border p-5 text-sm text-koma-muted">Nenhum grupo precisa de contato hoje. Consulte sua base em Clientes.</div>
              )}
              {opportunitiesCatalog.some((opp: any) => !opp.elegiveis_count) && (
                <details className="rounded-xl border border-koma-border bg-koma-panel px-4 py-3">
                  <summary className="min-h-8 cursor-pointer text-sm font-semibold text-koma-muted focus-visible:outline-2 focus-visible:outline-emerald-500">Outros grupos ({opportunitiesCatalog.filter((opp: any) => !opp.elegiveis_count).length})</summary>
                  <div className="mt-3 divide-y divide-koma-border">
                    {opportunitiesCatalog.filter((opp: any) => !opp.elegiveis_count).map((opp: any) => (
                      <div key={opp.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                        <span>{opp.titulo}</span><span className="shrink-0 text-xs text-koma-muted">Sem clientes hoje</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

            </div>
          )}

          {/* =====================================================================
              ABA 2: CLIENTES (Base pesquisável, filtros RFV legíveis e Ficha Individual)
             ===================================================================== */}
          {crmTab === 'clientes' && (
            <div className="space-y-3.5 animate-fade-in">
              <section className="koma-toolbar">
                <div className="koma-toolbar__search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    value={clientesSearch}
                    onChange={(event) => setClientesSearch(event.target.value)}
                    placeholder="Buscar por nome ou WhatsApp…"
                    aria-label="Buscar clientes"
                  />
                  {clientesSearch && (
                    <button type="button" onClick={() => setClientesSearch('')} aria-label="Limpar busca">
                      <X size={13} />
                    </button>
                  )}
                </div>
                {(clientesSearch || filteredLoyaltyUsers.length !== listUsers.length) && (
                  <p className="shrink-0 text-xs font-medium text-koma-muted max-sm:col-span-2">
                    <strong className="font-mono text-koma-foreground">{filteredLoyaltyUsers.length}</strong> de{' '}
                    {listUsers.length} carregados de {listTotal} encontrados no banco
                  </p>
                )}
                <label className="flex min-w-0 flex-col gap-1 text-xs text-koma-muted">
                  Ordenar clientes
                  <select
                    aria-label="Ordenar clientes"
                    value={customerSort}
                    onChange={(event) => setCustomerSort(event.target.value as CustomerSort)}
                    className="min-h-11 min-w-0 max-w-full rounded-lg border border-koma-border bg-koma-panel px-3 text-koma-foreground"
                  >
                    <option value="orders">Mais compras concluídas</option>
                    <option value="spent">Maior total pago</option>
                    <option value="recent">Compra mais recente</option>
                    <option value="absent">Mais tempo sem comprar</option>
                    <option value="name">Nome A–Z</option>
                  </select>
                </label>
                <div className="koma-toolbar__actions">
                  <button
                    type="button"
                    onClick={() => {
                      setNewCrmNome('');
                      setNewCrmTelefone('');
                      setNewCrmSaldo(0);
                      setShowNewCrmModal(true);
                    }}
                    className="koma-btn-success"
                  >
                    <Plus size={14} /> Novo cliente
                  </button>
                </div>
              </section>

              {/* Atalhos principais. Segmentos menos comuns ficam em Mais filtros. */}
              <div className="flex flex-nowrap gap-1.5 overflow-x-auto pb-1 [&>button]:shrink-0 sm:flex-wrap" aria-label="Filtrar clientes">
                {([
                  ['ALL', 'Todos'],
                  ['ATIVO', 'Ativos (até 30 dias)'],
                  ['REPEAT', 'Recorrentes (2+ compras)'],
                  ['REATIVAR', 'Reativar (+60 dias)'],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={customerSegment === value}
                    onClick={() => setCustomerSegment(value)}
                    className={`min-h-10 rounded-lg border px-3 text-sm focus-visible:outline-2 focus-visible:outline-emerald-500 ${
                      customerSegment === value
                        ? 'border-emerald-600 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300'
                        : 'border-koma-border text-koma-muted hover:bg-koma-raised'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>

              <details className="rounded-lg border border-koma-border bg-koma-panel px-3 py-1" aria-label="Filtros avançados de clientes">
                <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-koma-foreground focus-visible:outline-2 focus-visible:outline-emerald-500">
                  <span>Mais filtros</span>
                  <span className="text-xs font-normal text-koma-muted">{activeCustomerFilters ? `${activeCustomerFilters} ativo${activeCustomerFilters === 1 ? '' : 's'}` : 'Segmentos e critérios'}</span>
                </summary>
                <div className="space-y-3 pt-3">
                  <div className="flex flex-wrap gap-1.5" aria-label="Outros segmentos de clientes">
                    {([
                      ['SECOND_PURCHASE', 'Elegíveis 2ª compra (6–30d)'],
                      ['CADENCE_RECOVERY', 'Fora do ritmo habitual'],
                      ['ATENCAO', 'Atenção (31–60 dias)'],
                      ['SEM_COMPRA', 'Sem compra identificada'],
                    ] as const).map(([value, label]) => (
                      <button key={value} type="button" aria-pressed={customerSegment === value}
                        onClick={() => setCustomerSegment(value)}
                        className={`min-h-10 rounded-lg border px-3 text-sm focus-visible:outline-2 focus-visible:outline-emerald-500 ${
                          customerSegment === value
                            ? 'border-emerald-600 bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300'
                            : 'border-koma-border text-koma-muted hover:bg-koma-raised'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>

              {/* Filtros comportamentais compreensíveis (Recência, Frequência, Valor, Produto, Benefício, Contato) */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm font-medium text-koma-muted">
                  Última compra (Recência)
                  <select
                    aria-label="Filtrar por última compra"
                    value={recencyFilter}
                    onChange={(e) => setRecencyFilter(e.target.value as CrmRecencyFilter)}
                    className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-2 min-h-10 text-sm text-koma-foreground"
                  >
                    <option value="ALL">Qualquer data</option>
                    <option value="ATE_15">Até 15 dias</option>
                    <option value="16_30">16 a 30 dias</option>
                    <option value="31_60">31 a 60 dias</option>
                    <option value="MAIS_60">Mais de 60 dias</option>
                    <option value="SEM_COMPRA">Sem compra identificada</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-koma-muted">
                  Frequência de pedidos
                  <select
                    aria-label="Filtrar por frequência de pedidos"
                    value={frequencyFilter}
                    onChange={(e) => setFrequencyFilter(e.target.value as CrmFrequencyFilter)}
                    className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-2 min-h-10 text-sm text-koma-foreground"
                  >
                    <option value="ALL">Qualquer quantidade</option>
                    <option value="SEM_COMPRA">0 compras (apenas cadastro)</option>
                    <option value="UMA_COMPRA">1 compra concluída</option>
                    <option value="RECORRENTE_2_3">2 a 3 compras</option>
                    <option value="FREQUENTE_4_MAIS">4 ou mais compras</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-koma-muted">
                  Total líquido pago
                  <select
                    aria-label="Filtrar por valor total pago"
                    value={valueFilter}
                    onChange={(e) => setValueFilter(e.target.value as CrmValueFilter)}
                    className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-2 min-h-10 text-sm text-koma-foreground"
                  >
                    <option value="ALL">Qualquer valor</option>
                    <option value="ATE_100">Até R$ 100</option>
                    <option value="100_300">De R$ 100 a R$ 300</option>
                    <option value="MAIS_300">Acima de R$ 300</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-koma-muted">
                  Produto entre mais pedidos
                  <input
                    type="text"
                    aria-label="Filtrar por produto entre mais pedidos"
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    placeholder="Ex.: Risoto, Burger…"
                    className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-2 min-h-10 text-sm text-koma-foreground"
                  />
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-koma-muted">
                  Benefício de fidelidade
                  <select
                    aria-label="Filtrar por situação do benefício"
                    value={benefitFilter}
                    onChange={(e) => setBenefitFilter(e.target.value as CrmBenefitFilter)}
                    className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-2 min-h-10 text-sm text-koma-foreground"
                  >
                    <option value="ALL">Qualquer situação</option>
                    <option value="RESGATAVEL">Pronto para resgate</option>
                    <option value="SALDO_EM_FORMACAO">Saldo em formação (não resgatável)</option>
                    <option value="SEM_SALDO">Sem saldo</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-koma-muted">
                  Status de contato
                  <select
                    aria-label="Filtrar por status de contato"
                    value={contactFilter}
                    onChange={(e) => setContactFilter(e.target.value as CrmContactFilter)}
                    className="rounded-lg border border-koma-border bg-koma-panel px-2.5 py-2 min-h-10 text-sm text-koma-foreground"
                  >
                    <option value="ALL">Todos</option>
                    <option value="DISPONIVEL_ABORDAGEM">Disponível para abordar</option>
                    <option value="CONTATO_RECENTE">Abordado nos últimos 7 dias</option>
                    <option value="VOLTOU_APOS_CONTATO">Voltou após abordagem</option>
                    <option value="OPT_OUT">Opt-out (excluído de campanhas)</option>
                  </select>
                </label>
              </div>

                </div>
              </details>

              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-koma-muted">
                <p>
                  {filteredLoyaltyUsers.length} de {listTotal} clientes · {customerSort === 'orders' ? 'Mais compras primeiro; desempate pelo total pago.' : 'Compras concluídas e valores líquidos pagos.'}
                </p>
                {activeCustomerFilters > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerSegment('ALL');
                      setRecencyFilter('ALL');
                      setFrequencyFilter('ALL');
                      setValueFilter('ALL');
                      setProductQuery('');
                      setBenefitFilter('ALL');
                      setContactFilter('ALL');
                    }}
                    className="min-h-10 font-semibold text-emerald-600 hover:underline focus-visible:outline-2 focus-visible:outline-emerald-500 dark:text-emerald-400"
                  >
                    Limpar filtros ({activeCustomerFilters})
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {listHasMore && (
                  <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-koma-panel p-3 text-sm text-koma-muted">
                    <span>Exibindo {listUsers.length} de {listTotal} clientes {searchTerm ? 'encontrados na pesquisa' : 'cadastrados'}. Ordenação aplicada à base inteira. Filtros adicionais consideram os registros carregados.</span>
                    <button type="button" disabled={activeSearch ? Boolean(queryResult?.loading) : loadingMoreCustomers} onClick={() => void (activeSearch ? loadNextSearchPage() : loadMoreCustomers())}
                      className="koma-btn-secondary min-h-11 rounded-lg px-3 font-semibold disabled:opacity-40">
                      {activeSearch ? (queryResult?.loading ? 'Carregando…' : 'Carregar mais resultados') : (loadingMoreCustomers ? 'Carregando…' : 'Carregar mais 100 clientes')}
                    </button>
                  </div>
                )}
                {activeSearch && queryResult?.error && listUsers.length > 0 && <p role="alert" className="text-sm text-amber-300">{queryResult.error} <button type="button" className="ml-2 underline" onClick={() => setSearchRetry(value => value + 1)}>Tentar novamente</button></p>}
                {productQuery.trim() && favoriteSnapshot.scope === searchScope && favoriteSnapshot.loading && (
                  <p role="status" className="my-2 text-sm text-koma-muted">Consultando os produtos dos clientes carregados para aplicar este filtro…</p>
                )}
                {productQuery.trim() && favoriteSnapshot.scope === searchScope && favoriteSnapshot.error && (
                  <div role="alert" className="my-2 text-sm text-amber-300">{favoriteSnapshot.error}
                    <button type="button" className="ml-2 underline" onClick={() => { setFavoriteSnapshot(prev => ({ ...prev, error: null })); setFavoriteRetry(n => n + 1); }}>Tentar novamente</button>
                  </div>
                )}
                {activeSearch && (!queryResult || (queryResult.loading && !listUsers.length)) ? (
                  <p role="status" className="rounded-xl border border-koma-border bg-koma-panel p-4 text-sm text-koma-muted">Carregando clientes na ordem selecionada…</p>
                ) : activeSearch && queryResult?.error && !listUsers.length ? (
                  <div role="alert" className="rounded-xl border border-amber-500/30 bg-koma-panel p-4 text-sm text-amber-300">{queryResult.error} <button type="button" className="ml-2 underline" onClick={() => setSearchRetry(value => value + 1)}>Tentar novamente</button></div>
                ) : filteredLoyaltyUsers.length > 0 ? (
                  <>
                    {/* Lista Mobile Compacta */}
                    <div className="grid gap-2 md:hidden">
                      {pageCustomers.map((user) => (
                        <article
                          key={user.id}
                          className="min-w-0 rounded-xl border border-koma-border bg-koma-raised p-3"
                        >
                          <div className="flex min-w-0 items-start justify-between gap-3">
                            <div className="min-w-0">
                              <strong className="block break-words text-sm text-koma-foreground">
                                {user.cliente}
                              </strong>
                              <span className="block font-mono text-xs text-koma-muted">
                                {formatarTelefoneTabela(user.telefone)}
                              </span>
                              <CustomerHabits customer={user} />
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => setSelectedProfileCustomerId(user.id)}
                                className="koma-btn-secondary min-h-10 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                              >
                                Ver perfil
                              </button>
                              <button
                                type="button"
                                onClick={() => startEditingCustomer(user)}
                                className="koma-btn-secondary min-h-10 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                              >
                                Editar
                              </button>
                            </div>
                          </div>
                          <dl
                            className={`mt-3 grid ${
                              hasLoyalty ? 'grid-cols-3' : 'grid-cols-2'
                            } gap-2 border-t border-koma-border pt-3 text-xs`}
                          >
                            <div className="min-w-0">
                              <dt className="text-[10px] text-koma-muted">Última compra</dt>
                              <dd className="mt-1 font-mono text-koma-foreground">
                                {ultimaCompraLabel(user.dias_sem_comprar)}
                              </dd>
                              <dd className="mt-1 text-koma-muted">{customerSegmentLabel(user)}</dd>
                            </div>
                            <div className="min-w-0">
                              <dt className="text-[10px] text-koma-muted">Pedidos</dt>
                              <dd className="mt-1 font-mono text-koma-foreground">
                                {user.pedidos_concluidos ?? 0}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-koma-muted">Total pago</dt>
                              <dd className="mt-1 text-koma-foreground">{money(user.valor_pago_total)}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-koma-muted">Ticket médio</dt>
                              <dd className="mt-1 text-koma-foreground">{money(user.ticket_medio_pago)}</dd>
                            </div>
                            {user.produtos_favoritos !== undefined && <div className="col-span-full">
                              <dt className="text-[10px] text-koma-muted">Produtos mais pedidos</dt>
                              <dd className="mt-1 break-words text-koma-foreground">
                                {user.produtos_favoritos?.length
                                  ? user.produtos_favoritos
                                      .map((product) => `${product.nome} (${product.unidades} un.)`)
                                      .join(' · ')
                                  : user.produtos_favoritos === undefined ? 'Favoritos ainda não consultados' : 'Sem itens identificados'}
                              </dd>
                            </div>}
                            {hasLoyalty && (
                              <div className="col-span-full">
                                <dt className="text-[10px] text-koma-muted">Benefício (Acumulado vs. Resgatável)</dt>
                                <dd className="mt-1 break-words font-mono font-extrabold text-emerald-700 dark:text-emerald-400">
                                  {(savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS'
                                    ? `${user.pontos} pts`
                                    : `R$ ${user.saldoCashback.toFixed(2)}`}
                                  {user.status_beneficio === 'SALDO_EM_FORMACAO' && (
                                    <span className="ml-1.5 text-[10px] font-normal text-amber-300">
                                      (Saldo em formação — ainda não permite resgate)
                                    </span>
                                  )}
                                </dd>
                              </div>
                            )}
                          </dl>
                        </article>
                      ))}
                    </div>

                    {/* Tabela Desktop Compacta */}
                    <div className="hidden overflow-x-auto border border-koma-border rounded-2xl md:block">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="bg-koma-raised border-b border-koma-border text-koma-muted uppercase tracking-wider font-extrabold text-[9px]">
                            <th className="p-3.5">Cliente</th>
                            <th className="p-3.5">WhatsApp & Status</th>
                            <th className="p-3.5">Última compra</th>
                            <th className="p-3.5">Pedidos</th>
                            <th className="p-3.5">Total pago / ticket médio</th>
                            {showFavoriteColumn && <th className="p-3.5">Produtos mais pedidos</th>}
                            {hasLoyalty && <th className="p-3.5 font-mono">Benefício atual</th>}
                            <th className="p-3.5 text-right">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-koma-border">
                          {pageCustomers.map((user) => (
                            <tr key={user.id} className="hover:bg-koma-raised/50 transition-colors">
                              <td className="p-3.5 font-bold text-koma-foreground">
                                <button
                                  type="button"
                                  onClick={() => setSelectedProfileCustomerId(user.id)}
                                  className="text-left font-bold text-koma-foreground hover:text-emerald-400 hover:underline"
                                >
                                  <strong>{user.cliente}</strong>
                                </button>
                                <CustomerHabits customer={user} />
                              </td>
                              <td className="p-3.5 font-mono text-koma-muted text-xs">
                                {formatarTelefoneTabela(user.telefone)}
                                {user.opt_out_marketing ? (
                                  <span className="mt-1 block text-[10px] font-sans font-bold text-rose-400">
                                    Opt-out de campanhas
                                  </span>
                                ) : user.contato_recente ? (
                                  <span className="mt-1 block text-[10px] font-sans font-semibold text-amber-300">
                                    Abordado há {user.dias_desde_ultimo_contato ?? 0}d
                                  </span>
                                ) : user.voltou_apos_ultimo_contato ? (
                                  <span className="mt-1 block text-[10px] font-sans font-semibold text-emerald-400">
                                    Voltou após contato
                                  </span>
                                ) : null}
                              </td>
                              <td className="p-3.5 font-mono text-xs text-koma-muted">
                                {ultimaCompraLabel(user.dias_sem_comprar)}
                                <span className="mt-1 block text-koma-muted">{customerSegmentLabel(user)}</span>
                              </td>
                              <td className="p-3.5 font-mono text-xs text-koma-foreground">
                                {user.pedidos_concluidos ?? 0}
                              </td>
                              <td className="p-3.5 text-koma-foreground">
                                {money(user.valor_pago_total)}
                                <span className="mt-1 block text-koma-muted">
                                  Média {money(user.ticket_medio_pago)}
                                </span>
                              </td>
                              {showFavoriteColumn && <td className="max-w-56 p-3.5 text-koma-foreground">
                                {user.produtos_favoritos?.length ? (
                                  user.produtos_favoritos.map((product) => (
                                    <span className="block" key={product.produto_id}>
                                      {product.nome}{' '}
                                      <span className="text-koma-muted">{product.unidades} un.</span>
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-koma-muted">{user.produtos_favoritos === undefined ? '—' : 'Sem itens identificados'}</span>
                                )}
                              </td>}
                              {hasLoyalty && (
                                <td className="p-3.5 font-mono text-xs">
                                  <span className="font-extrabold text-emerald-700 dark:text-emerald-400 block">
                                    {(savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS'
                                      ? `${user.pontos} pts`
                                      : `R$ ${user.saldoCashback.toFixed(2)}`}
                                  </span>
                                  {user.elegivel_resgate ? (
                                    <span className="text-[10px] font-sans text-emerald-400">
                                      Resgatável ({money(user.valor_resgatavel_brl)})
                                    </span>
                                  ) : user.pontos > 0 || user.saldoCashback > 0 ? (
                                    <span className="text-[10px] font-sans text-amber-300">
                                      Saldo em formação
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-sans text-koma-muted">Sem saldo</span>
                                  )}
                                </td>
                              )}
                              <td className="p-3.5 text-right">
                                <div className="inline-flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedProfileCustomerId(user.id)}
                                    className="min-h-9 whitespace-nowrap px-3 py-1.5 koma-btn-secondary rounded-lg transition-all cursor-pointer font-semibold text-xs"
                                  >
                                    Ver perfil
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => startEditingCustomer(user)}
                                    className="px-3 py-1.5 koma-btn-secondary rounded-xl transition-all cursor-pointer font-bold text-xs"
                                  >
                                    Editar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <KomaEmptyState
                    icon={<Users size={24} className="text-koma-muted" />}
                    title={
                      listTotal === 0 && !activeSearch ? 'Nenhum cliente cadastrado ainda' : 'Nenhum cliente encontrado'
                    }
                    description={
                      listTotal === 0 && !activeSearch
                        ? 'Cadastre clientes ou aguarde os primeiros pedidos identificados no cardápio e balcão.'
                        : 'Ajuste ou limpe a busca para ver outros clientes.'
                    }
                    action={
                      listTotal === 0 && !activeSearch
                        ? {
                            label: 'Cadastrar primeiro cliente',
                            onClick: () => {
                              setNewCrmNome('');
                              setNewCrmTelefone('');
                              setNewCrmSaldo(0);
                              setShowNewCrmModal(true);
                            },
                          }
                        : {
                            label: 'Limpar filtros',
                            onClick: () => {
                              setClientesSearch('');
                              setCustomerSegment('ALL');
                              setRecencyFilter('ALL');
                              setFrequencyFilter('ALL');
                              setValueFilter('ALL');
                              setProductQuery('');
                              setBenefitFilter('ALL');
                              setContactFilter('ALL');
                            },
                            variant: 'secondary',
                          }
                    }
                    variant="panel"
                  />
                )}
              </div>

              <nav
                aria-label="Páginas de clientes"
                className="flex flex-wrap items-center justify-between gap-3 text-xs text-koma-muted"
              >
                <label className="flex items-center gap-2">
                  Clientes por página{' '}
                  <select
                    aria-label="Clientes por página"
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value))}
                    className="min-h-11 rounded-lg border border-koma-border bg-koma-panel px-3 text-koma-foreground"
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </label>
                <span>
                  {filteredLoyaltyUsers.length ? (currentPage - 1) * pageSize + 1 : 0}–
                  {Math.min(currentPage * pageSize, filteredLoyaltyUsers.length)} de {filteredLoyaltyUsers.length}{' '}
                  clientes {listHasMore ? 'carregados (lista parcial)' : '(base consultada)'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setCustomerPage(currentPage - 1)}
                    className="koma-btn-secondary min-h-11 rounded-lg px-3 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span>
                    {currentPage} / {pageCount}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage === pageCount}
                    onClick={() => setCustomerPage(currentPage + 1)}
                    className="koma-btn-secondary min-h-11 rounded-lg px-3 disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              </nav>
            </div>
          )}

          {/* =====================================================================
              ABA 3: CAMPANHAS (Fluxo guiado objetivo → público → benefício → mensagem → registro)
             ===================================================================== */}
          {(crmTab === 'campanhas' || visitedCampaigns) && (
            <div hidden={crmTab !== 'campanhas'} style={{ display: crmTab === 'campanhas' ? undefined : 'none' }}>
              <CustomerCampaignsWorkspace
              apiBaseUrl={apiBaseUrl}
              authHeaders={authHeaders}
              customers={currentExternalCustomer && !loyaltyUsers.some(c => c.id === currentExternalCustomer.id) ? [...loyaltyUsers, currentExternalCustomer] : loyaltyUsers}
              totalCustomers={totalCustomers}
              hasMoreCustomers={hasMoreCustomers}
              onLoadMoreCustomers={loadMoreCustomers}
              opportunities={crmSummary?.oportunidades ?? []}
              draftSeed={campaignDraftSeed}
              hasLoyalty={hasLoyalty}
              hasCoupons={hasCoupons}
              showToast={showToast}
              onRefreshCustomers={async () => {
                await refreshLoyaltyUsers();
                await loadCrmSummary();
              }}
              onOpenResults={() => handleSelectCrmTab('resultados')}
              onInspectCustomer={(customer) => { setExternalCampaignCustomer({ scope: searchScope, customer }); setSelectedProfileCustomerId(customer.id); }}
              />
            </div>
          )}

          {/* =====================================================================
              ABA 4: BENEFÍCIOS (Reúne Programa de Fidelidade e Cupons com subdivisões claras)
             ===================================================================== */}
          {(crmTab === 'beneficios' || visitedBenefits) && (
            <div hidden={crmTab !== 'beneficios'} style={{ display: crmTab === 'beneficios' ? undefined : 'none' }} className="space-y-4 animate-fade-in">
              {/* Subdivisão Clara: Saldo Acumulado vs. Resgatável + Seletor Fidelidade / Cupons */}
              <div className="rounded-2xl border border-koma-border bg-koma-card p-3 sm:p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-koma-foreground">
                      Benefícios para a próxima compra
                    </h3>
                    <p className="text-xs text-koma-muted">
                      Alterações são revisadas antes de serem salvas. Os saldos concedidos permanecem registrados.
                    </p>
                  </div>


                </div>

                {hasLoyalty && hasCoupons && (
                  <div role="tablist" aria-label="Tipos de benefícios" className="flex flex-wrap gap-2 pt-1"
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
                      const selected = tabs.findIndex(tab => tab === document.activeElement);
                      if (selected < 0) return;
                      event.preventDefault();
                      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
                        : (selected + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
                      setActiveSubTab(tabs[next].dataset.benefitTab || 'fidelidade');
                      tabs[next].focus();
                    }}>
                    {(['fidelidade', 'cupons'] as const).map(section => (
                      <button key={section} type="button" role="tab" id={`crm-benefit-tab-${section}`}
                        data-benefit-tab={section}
                        aria-controls={`crm-benefit-panel-${section}`}
                        aria-selected={beneficiosSection === section}
                        tabIndex={beneficiosSection === section ? 0 : -1}
                        onClick={() => setActiveSubTab(section)}
                        className={`min-h-11 rounded-lg px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${beneficiosSection === section ? 'bg-koma-raised text-koma-foreground' : 'text-koma-muted hover:bg-koma-raised'}`}>
                        {section === 'fidelidade' ? 'Fidelidade' : 'Cupons'}
                      </button>
                    ))}
                  </div>
                )}

              </div>

              {hasLoyalty && (beneficiosSection === 'fidelidade' || visitedFidelity) && (
                <div id="crm-benefit-panel-fidelidade" role="tabpanel" aria-label="Fidelidade"
                  hidden={beneficiosSection !== 'fidelidade'}
                  style={{ display: beneficiosSection === 'fidelidade' ? undefined : 'none' }}>
                  <LoyaltyProgramPanel
                    apiBaseUrl={apiBaseUrl} authHeaders={authHeaders}
                    saved={savedLoyaltyConfig} draft={fidelidadeConfig}
                    dirty={loyalty.dirty} loading={loyalty.loading} saving={loyalty.saving}
                    error={loyalty.error} onRetry={loyalty.reload}
                    onEdit={setFidelidadeConfig} onDiscard={loyalty.discard}
                    onSave={confirmSaveFidelidadeConfig}
                    onApplyOption={handleApplyGrowthOptionToLoyalty}
                    canRedeem={relationshipSummary.resgataveis} accumulating={relationshipSummary.emFormacao}
                    onOpenCustomers={() => handleSelectCrmTab('clientes')}
                  />
                </div>
              )}

              {/* Subdivisão B: Cupons & Promoções */}
              {hasCoupons && (beneficiosSection === 'cupons' || visitedCoupons) && (
                <div id="crm-benefit-panel-cupons" role="tabpanel" aria-label="Cupons" hidden={beneficiosSection !== 'cupons'}
                  style={{ display: beneficiosSection === 'cupons' ? undefined : 'none' }} className="space-y-4">
                  <CuponsTab
                    apiBaseUrl={apiBaseUrl}
                    authHeaders={authHeaders}
                    onShowNotification={(msg, type) => showToast(msg, type === 'error' ? 'error' : 'success')}
                    onUseCupomInCampaign={handleUseCupomInCampaign}
                  />
                </div>
              )}
            </div>
          )}

          {/* =====================================================================
              ABA 5: RESULTADOS (Indicadores de decisão, atribuição honesta e satisfação)
             ===================================================================== */}
          {crmTab === 'resultados' && (
            <div className="space-y-4 animate-fade-in">
              <CustomerResultsWorkspace
                crmSummary={crmSummary}
                loading={crmSummaryLoading}
                error={crmSummaryError}
                periodoDias={periodoDias}
                janelaDias={janelaDias}
                onChangePeriodo={setPeriodoDias}
                onChangeJanela={setJanelaDias}
                onRefresh={() => void loadCrmSummary()}
              />

              <div className="space-y-3 pt-2">
                <CustomerRelationshipPanel customers={loyaltyUsers} />
                <CustomerSatisfactionPanel
                  resumo={satisfactionData.resumo}
                  recentes={satisfactionData.recentes}
                  isLoading={isSatisfactionLoading}
                  onOpenRegisterModal={handleOpenSatisfactionModal}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Painel Lateral: Ficha Individual do Cliente (preserva filtros e página ao fechar) */}
      <CustomerProfileDrawer
        customer={selectedProfileCustomer}
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        onClose={() => setSelectedProfileCustomerId(null)}
        onUpdated={async () => {
          await refreshLoyaltyUsers();
          await loadCrmSummary();
        }}
        onStartCampaignForCustomer={handleStartCampaignForSingleCustomer}
        onEditCustomerBasic={(c) => { setSelectedProfileCustomerId(null); startEditingCustomer(c); }}
        showToast={showToast}
      />

      {editingCrmUser && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditingCrmUser(null);
          }}
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="cashier-customer-modal w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-koma-border">
              <h3 className="font-serif text-sm font-bold text-koma-foreground">Editar Cliente CRM</h3>
              <button
                type="button"
                onClick={() => setEditingCrmUser(null)}
                className="p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!crmFormNome.trim() || !crmFormTelefone.trim()) {
                  alert('Preencha todos os campos!');
                  return;
                }
                const newSaldo = hasLoyalty
                  ? (savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS'
                    ? crmFormPontos
                    : crmFormCashback
                  : undefined;
                const updated = await handleUpdateClient(
                  editingCrmUser.id,
                  crmFormNome,
                  crmFormTelefone,
                  newSaldo,
                );
                if (updated) setEditingCrmUser(null);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Telefone / WhatsApp:
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={crmFormTelefone}
                  onChange={(e) => setCrmFormTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Nome:
                </label>
                <input
                  type="text"
                  required
                  value={crmFormNome}
                  onChange={(e) => setCrmFormNome(e.target.value)}
                  className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"
                />
              </div>

              {hasLoyalty && (
                <div className="grid grid-cols-2 gap-4">
                  {(savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS' ? (
                    <div className="space-y-1 col-span-2">
                      <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                        Saldo de Pontos (Ajuste):
                      </label>
                      <input
                        type="number"
                        required
                        value={crmFormPontos}
                        onChange={(e) => setCrmFormPontos(Number(e.target.value))}
                        className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1 col-span-2">
                      <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                        Saldo Cashback R$ (Ajuste):
                      </label>
                      <MoneyInput
                        required
                        value={crmFormCashback}
                        onValueChange={(value) => setCrmFormCashback(Number(value || 0))}
                        className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingCrmUser(null)}
                  className="flex-1 py-2 bg-koma-card hover:bg-koma-raised border border-koma-border text-koma-foreground rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl font-bold cursor-pointer transition-colors"
                >
                  Salvar Alterações
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showNewCrmModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNewCrmModal(false);
          }}
          className="fixed inset-0 bg-black/85 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto cursor-pointer"
        >
          <div className="cashier-customer-modal w-full max-w-md bg-koma-card border border-koma-border rounded-3xl p-6 space-y-4 text-left shadow-2xl relative animate-scale-in my-8">
            <div className="flex justify-between items-center pb-2 border-b border-koma-border">
              <h3 className="font-serif text-sm font-bold text-koma-foreground">Cadastrar Novo Cliente</h3>
              <button
                type="button"
                onClick={() => setShowNewCrmModal(false)}
                className="p-1 text-koma-subtle hover:text-koma-foreground transition-colors cursor-pointer border border-transparent"
              >
                <X size={16} />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCrmNome.trim() || !newCrmTelefone.trim()) {
                  alert('Preencha todos os campos!');
                  return;
                }
                const created = await handleCreateClient(
                  newCrmNome,
                  newCrmTelefone,
                  hasLoyalty ? Number(newCrmSaldo || 0) : 0,
                );
                if (created) setShowNewCrmModal(false);
              }}
              className="space-y-4"
            >
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Telefone / WhatsApp:
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  required
                  autoFocus
                  placeholder="(00) 00000-0000"
                  value={newCrmTelefone}
                  onChange={(e) => setNewCrmTelefone(aplicarMascaraTelefoneInput(e.target.value))}
                  className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Nome:
                </label>
                <input
                  type="text"
                  required
                  value={newCrmNome}
                  onChange={(e) => setNewCrmNome(e.target.value)}
                  className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981]"
                />
              </div>

              {hasLoyalty && (
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                    {(savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS' ? 'Pontos Iniciais:' : 'Cashback Inicial R$:'}
                  </label>
                  {(savedLoyaltyConfig ?? DEFAULT_LOYALTY_CONFIG).tipo_recompensa === 'PONTOS' ? (
                    <input
                      type="number"
                      step="1"
                      value={newCrmSaldo}
                      onChange={(e) => setNewCrmSaldo(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"
                    />
                  ) : (
                    <MoneyInput
                      value={newCrmSaldo}
                      onValueChange={setNewCrmSaldo}
                      className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] font-mono text-xs"
                    />
                  )}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewCrmModal(false)}
                  className="flex-1 py-2 border border-koma-border hover:border-koma-border bg-zinc-950 text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSatisfactionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-koma-border bg-koma-panel p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-koma-border-subtle">
              <div>
                <p className="orders-eyebrow">
                  <span /> SATISFAÇÃO
                </p>
                <h3 className="text-sm font-black text-koma-foreground">Registrar avaliação de cliente</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSatisfactionModal(false)}
                className="text-koma-muted hover:text-koma-foreground transition-colors p-1"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleRegisterSatisfaction} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Cliente cadastrado:
                </label>
                {loyaltyUsers.length === 0 ? (
                  <p className="text-xs text-amber-500 py-1">Nenhum cliente cadastrado no restaurante.</p>
                ) : (
                  <select
                    value={satisfactionClienteId}
                    onChange={(e) => setSatisfactionClienteId(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] text-xs"
                  >
                    <option value="" disabled>
                      Selecione um cliente…
                    </option>
                    {loyaltyUsers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome || c.cliente} {c.telefone ? `(${formatarTelefoneTabela(c.telefone)})` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Nota (1 a 5 estrelas):
                </label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSatisfactionNota(n)}
                      className={`flex-1 py-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer ${
                        satisfactionNota === n
                          ? n >= 4
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30'
                            : n === 3
                            ? 'border-amber-500 bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30'
                            : 'border-rose-500 bg-rose-500/10 text-rose-600 dark:text-rose-400 ring-1 ring-rose-500/30'
                          : 'border-koma-border bg-koma-canvas/50 text-koma-muted hover:border-koma-border/80'
                      }`}
                    >
                      <span className="text-sm font-black">{n}</span>
                      <span className="text-[9px] font-medium text-koma-subtle">
                        {n >= 4 ? 'Positiva' : n === 3 ? 'Neutra' : 'Insat.'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-koma-subtle uppercase tracking-wider block">
                  Comentário opcional (máx. 1000 caracteres):
                </label>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={satisfactionComentario}
                  onChange={(e) => setSatisfactionComentario(e.target.value)}
                  placeholder="Ex.: Elogiou a velocidade da entrega e o atendimento…"
                  className="w-full px-3 py-2 bg-koma-panel border border-koma-border rounded-xl text-koma-foreground focus:outline-none focus:border-[#10b981] text-xs resize-none"
                />
                <span className="text-[9px] text-koma-subtle block text-right font-mono">
                  {satisfactionComentario.length}/1000
                </span>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSatisfactionModal(false)}
                  className="flex-1 py-2 border border-koma-border bg-zinc-950 text-koma-subtle hover:text-koma-foreground rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingSatisfaction || loyaltyUsers.length === 0}
                  className="flex-1 py-2 bg-[#10b981] hover:bg-[#059669] text-[#121214] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingSatisfaction ? 'Salvando…' : 'Registrar avaliação'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
