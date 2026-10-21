import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  ExternalLink,
  Gift,
  MessageSquare,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';
import {
  buildManualWhatsAppUrl,
  DEFAULT_CRM_TEMPLATES,
  interpolateCrmTemplate,
  matchesCustomerSegment,
  type CustomerSegment,
} from '../../../domain/customerCrm';
import type { CupomData } from '../../clientes/CuponsTab';
import type { CashierNotice, LoyaltyCustomer } from '../cashierContracts';
import { mapCustomers } from './useCashierCustomers';

export interface CrmCampaignDraftSeed {
  objetivo: string;
  titulo?: string;
  customerIds?: string[];
  tipoAbordagem?: 'SEM_DESCONTO' | 'FIDELIDADE' | 'CUPOM';
  cupomId?: string;
}

interface Props {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  customers: LoyaltyCustomer[];
  totalCustomers: number;
  hasMoreCustomers: boolean;
  onLoadMoreCustomers: () => Promise<void>;
  opportunities: Array<{ id?: string; elegiveis_cliente_ids?: string[]; elegiveis_ids?: string[]; elegiveis_count?: number }>;
  draftSeed: CrmCampaignDraftSeed | null;
  hasLoyalty: boolean;
  hasCoupons: boolean;
  showToast: CashierNotice;
  onRefreshCustomers: () => Promise<void>;
  onOpenResults: () => void;
  onInspectCustomer: (customer: LoyaltyCustomer) => void;
}

const OBJECTIVES = [
  {
    id: 'SECOND_PURCHASE',
    label: 'Incentivar a 2ª compra',
    shortRule: '1 compra concluída, entre 6 e 30 dias sem voltar.',
  },
  {
    id: 'CADENCE_RECOVERY',
    label: 'Recuperar recorrentes fora do ritmo',
    shortRule: '3+ compras concluídas e ausência acima de 1,5x o intervalo médio.',
  },
  {
    id: 'BENEFIT_REMINDER',
    label: 'Lembrar benefício disponível',
    shortRule: 'Saldo resgatável (>= R$ 1,00) e 10+ dias sem comprar.',
  },
  {
    id: 'VIP_RECOGNITION',
    label: 'Reconhecer clientes frequentes',
    shortRule: '4+ compras concluídas e ativo nos últimos 45 dias.',
  },
  {
    id: 'OCCURRENCE_RECOVERY',
    label: 'Retomar relacionamento após ocorrência',
    shortRule: 'Avaliação <= 2 estrelas ainda sem pedido posterior.',
  },
] as const;

export function CustomerCampaignsWorkspace({
  apiBaseUrl,
  authHeaders,
  customers,
  totalCustomers,
  hasMoreCustomers,
  onLoadMoreCustomers,
  opportunities,
  draftSeed,
  hasLoyalty,
  hasCoupons,
  showToast,
  onRefreshCustomers,
  onOpenResults,
  onInspectCustomer,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [objetivo, setObjetivo] = useState<string>(draftSeed?.objetivo || 'SECOND_PURCHASE');
  const [nomeCampanha, setNomeCampanha] = useState<string>(
    draftSeed?.titulo || 'Ação comercial: Incentivar a 2ª compra',
  );
  const [tipoAbordagem, setTipoAbordagem] = useState<'SEM_DESCONTO' | 'FIDELIDADE' | 'CUPOM'>(
    draftSeed?.tipoAbordagem || 'SEM_DESCONTO',
  );
  const [selectedCupomId, setSelectedCupomId] = useState<string>(draftSeed?.cupomId || '');
  const [templateMensagem, setTemplateMensagem] = useState<string>(
    DEFAULT_CRM_TEMPLATES.SECOND_PURCHASE.semDesconto,
  );
  const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([]);
  const [previewCustomerId, setPreviewCustomerId] = useState('');
  const [copiedMessageIds, setCopiedMessageIds] = useState<Record<string, boolean>>({});
  const [supplementaryCustomers, setSupplementaryCustomers] = useState<LoyaltyCustomer[]>([]);
  const [previewDetails, setPreviewDetails] = useState<Record<string, LoyaltyCustomer['produtos_favoritos']>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [audienceLoading, setAudienceLoading] = useState(false);
  const [audienceError, setAudienceError] = useState<string | null>(null);
  const audienceRequestRef = useRef(0);
  const audienceScope = `${apiBaseUrl}\u0000${authHeaders.Authorization || authHeaders.authorization || ''}`;
  const audienceScopeRef = useRef(audienceScope);
  useEffect(() => {
    if (audienceScopeRef.current === audienceScope) return;
    audienceScopeRef.current = audienceScope;
    audienceRequestRef.current += 1;
    setSupplementaryCustomers([]);
    setPreviewDetails({});
    setSelectedCustomerIds([]);
    setAudienceLoading(false);
    setAudienceError(null);
  }, [audienceScope]);
  const [cupons, setCupons] = useState<CupomData[]>([]);
  const [loadingCupons, setLoadingCupons] = useState(false);

  // Rascunho rápido de cupom dentro da campanha
  const [showQuickCouponDraft, setShowQuickCouponDraft] = useState(false);
  const [draftCodigo, setDraftCodigo] = useState('VOLTE10');
  const [draftTipo, setDraftTipo] = useState<'porcentagem' | 'fixo'>('porcentagem');
  const [draftValor, setDraftValor] = useState('10');
  const [draftMinimo, setDraftMinimo] = useState('40');
  const [creatingCoupon, setCreatingCoupon] = useState(false);

  // Estado de campanha salva e contatos registrados na sessão
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [recordingByCustomer, setRecordingByCustomer] = useState<Record<string, boolean>>({});
  const [recordedCustomerIds, setRecordedCustomerIds] = useState<Record<string, string>>({});
  const [openedWhatsAppIds, setOpenedWhatsAppIds] = useState<Record<string, boolean>>({});
  const [awaitingInitialCustomers, setAwaitingInitialCustomers] = useState(false);
  // Refs are synchronous guards: React state alone does not prevent double clicks
  // or late responses from an older draft from unlocking the current contact queue.
  const draftGenerationRef = useRef(0);
  const savingCampaignRef = useRef(false);
  const pendingContactIdsRef = useRef(new Set<string>());

  // A campanha já persistida não pode receber contatos de um rascunho alterado.
  // Editar gera um NOVO registro quando o operador salvar; não atualiza o histórico.
  const invalidateSavedCampaign = () => {
    draftGenerationRef.current += 1;
    setActiveCampaignId(null);
    setRecordedCustomerIds({});
    setOpenedWhatsAppIds({});
    setCopiedMessageIds({});
  };

  useEffect(() => {
    if (!hasCoupons) return;
    const controller = new AbortController();
    setLoadingCupons(true);
    fetch(`${apiBaseUrl}/caixa/cupons`, { headers: authHeaders, signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data)) {
          setCupons(data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCupons(false);
      });
    return () => controller.abort();
  }, [apiBaseUrl, authHeaders, hasCoupons]);

  // Calcula público elegível padrão para o objetivo quando não vier de uma seleção individual
  const currentOpportunity = opportunities.find(opp => opp.id === objetivo);
  const authoritativeAudienceIds = currentOpportunity?.elegiveis_cliente_ids || currentOpportunity?.elegiveis_ids || [];

  // Fetch selected eligible IDs in bounded tenant-scoped batches, never the whole client base.
  const loadCompleteOpportunityAudience = async () => {
    if (!authoritativeAudienceIds.length || audienceLoading) return;
    const request = ++audienceRequestRef.current;
    setAudienceLoading(true);
    setAudienceError(null);
    const hydrated: LoyaltyCustomer[] = [];
    try {
      for (let offset = 0; offset < authoritativeAudienceIds.length; offset += 100) {
        const ids = authoritativeAudienceIds.slice(offset, offset + 100);
        const params = new URLSearchParams({ ids: ids.join(','), limit: '100', offset: '0' });
        const response = await fetch(`${apiBaseUrl}/fidelidade/clientes?${params}`, { headers: authHeaders });
        if (!response.ok) throw new Error(`Consulta dos destinatários falhou (${response.status})`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error('Resposta inválida de destinatários');
        hydrated.push(...mapCustomers(data, response.headers.get('X-Products-Included') !== 'false'));
        if (audienceRequestRef.current !== request) return;
      }
      if (audienceRequestRef.current !== request) return;
      invalidateSavedCampaign();
      setSupplementaryCustomers(hydrated);
      setSelectedCustomerIds(hydrated.filter(c => !c.opt_out_marketing && !c.contato_recente && c.telefone_valido_whatsapp).map(c => c.id));
      if (hydrated.length !== authoritativeAudienceIds.length) {
        setAudienceError('Alguns destinatários não estavam disponíveis na consulta atual. Revise a seleção.');
      }
    } catch (error) {
      if (audienceRequestRef.current === request) setAudienceError(error instanceof Error ? error.message : 'Não foi possível consultar os destinatários.');
    } finally {
      if (audienceRequestRef.current === request) setAudienceLoading(false);
    }
  };

  const computeEligibleAudienceIds = (targetObjective: string) => {
    return customers
      .filter((c) => {
        if (c.opt_out_marketing || c.contato_recente) return false;
        return matchesCustomerSegment(c, targetObjective as CustomerSegment);
      })
      .map((c) => c.id);
  };

  useEffect(() => {
    audienceRequestRef.current += 1;
    setSupplementaryCustomers([]);
    setPreviewDetails({});
    setAudienceLoading(false);
    setAudienceError(null);
    const nextObj = draftSeed?.objetivo || 'SECOND_PURCHASE';
    const nextApproach =
      draftSeed?.tipoAbordagem || (nextObj === 'BENEFIT_REMINDER' && hasLoyalty ? 'FIDELIDADE' : 'SEM_DESCONTO');
    setObjetivo(nextObj);
    setTipoAbordagem(nextApproach);
    if (draftSeed?.cupomId) setSelectedCupomId(draftSeed.cupomId);
    const tplGroup = DEFAULT_CRM_TEMPLATES[nextObj] || DEFAULT_CRM_TEMPLATES.SECOND_PURCHASE;
    setTemplateMensagem(nextApproach === 'SEM_DESCONTO' ? tplGroup.semDesconto : tplGroup.comBeneficio);
    const objLabel = OBJECTIVES.find((o) => o.id === nextObj)?.label || 'Ação comercial';
    setNomeCampanha(draftSeed?.titulo || `Ação: ${objLabel}`);
    setSelectedCupomId(draftSeed?.cupomId || '');
    setStep(1);
    invalidateSavedCampaign();

    if (draftSeed?.customerIds && draftSeed.customerIds.length > 0) {
      setSelectedCustomerIds(draftSeed.customerIds);
      setAwaitingInitialCustomers(false);
    } else if (customers.length > 0) {
      setSelectedCustomerIds(computeEligibleAudienceIds(nextObj));
      setAwaitingInitialCustomers(false);
    } else {
      setSelectedCustomerIds([]);
      setAwaitingInitialCustomers(true);
    }
  }, [draftSeed]);

  // Carrega o público automático uma única vez se os clientes chegarem depois
  // da primeira renderização; refresh posterior não apaga contatos/edições.
  useEffect(() => {
    if (!awaitingInitialCustomers || customers.length === 0) return;
    setSelectedCustomerIds(computeEligibleAudienceIds(objetivo));
    setAwaitingInitialCustomers(false);
  }, [awaitingInitialCustomers, customers.length, objetivo]);

  const handleObjectiveChange = (nextObj: string) => {
    setObjetivo(nextObj);
    const nextApproach = nextObj === 'BENEFIT_REMINDER' && hasLoyalty ? 'FIDELIDADE' : tipoAbordagem;
    setTipoAbordagem(nextApproach);
    const tplGroup = DEFAULT_CRM_TEMPLATES[nextObj] || DEFAULT_CRM_TEMPLATES.SECOND_PURCHASE;
    setTemplateMensagem(nextApproach === 'SEM_DESCONTO' ? tplGroup.semDesconto : tplGroup.comBeneficio);
    const objLabel = OBJECTIVES.find((o) => o.id === nextObj)?.label || 'Ação comercial';
    setNomeCampanha(`Ação: ${objLabel}`);
    audienceRequestRef.current += 1;
    setSupplementaryCustomers([]);
    setAudienceLoading(false);
    setAudienceError(null);
    setSelectedCustomerIds(computeEligibleAudienceIds(nextObj));
    invalidateSavedCampaign();
  };

  const handleApproachChange = (nextApproach: 'SEM_DESCONTO' | 'FIDELIDADE' | 'CUPOM') => {
    setTipoAbordagem(nextApproach);
    const tplGroup = DEFAULT_CRM_TEMPLATES[objetivo] || DEFAULT_CRM_TEMPLATES.SECOND_PURCHASE;
    setTemplateMensagem(nextApproach === 'SEM_DESCONTO' ? tplGroup.semDesconto : tplGroup.comBeneficio);
    invalidateSavedCampaign();
  };

  const activeCoupons = useMemo(() => {
    const now = new Date();
    return cupons.filter((c) => {
      if (!c.ativo) return false;
      if (c.limite_usos != null && c.usos_atuais >= c.limite_usos) return false;
      if (c.valido_ate && new Date(c.valido_ate) < now) return false;
      return true;
    });
  }, [cupons]);

  const selectedCoupon = useMemo(
    () => activeCoupons.find((c) => String(c.id) === String(selectedCupomId)) || null,
    [activeCoupons, selectedCupomId],
  );

  const selectedCustomers = useMemo(() => {
    const scoped = audienceScopeRef.current === audienceScope;
    const idSet = new Set(scoped ? selectedCustomerIds : []);
    const present = new Set(customers.map(c => c.id));
    const pool = [...customers, ...(scoped ? supplementaryCustomers : []).filter(c => !present.has(c.id))];
    return pool.filter(c => idSet.has(c.id)).map(c => (
      scoped && Object.prototype.hasOwnProperty.call(previewDetails, c.id)
        ? { ...c, produtos_favoritos: previewDetails[c.id] } : c
    ));
  }, [customers, supplementaryCustomers, selectedCustomerIds, previewDetails, audienceScope]);

  const previewCustomer = selectedCustomers.find(customer => customer.id === previewCustomerId) || selectedCustomers[0] || null;
  // Resolve product details only for the selected preview, never for every campaign recipient.
  const previewId = previewCustomer?.id || '';
  const previewRequiresProducts = templateMensagem.includes('{produto_favorito}');
  useEffect(() => {
    if (step !== 2 || !previewRequiresProducts || !previewId || previewCustomer?.produtos_favoritos !== undefined) return;
    const controller = new AbortController();
    setPreviewLoading(true);
    const params = new URLSearchParams({ ids: previewId, include_products: 'true', limit: '1' });
    fetch(`${apiBaseUrl}/fidelidade/clientes?${params}`, { headers: authHeaders, signal: controller.signal })
      .then(async res => {
        if (!res.ok) throw new Error('Favoritos indisponíveis');
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) throw new Error('Cliente não localizado na consulta');
        const normalized = mapCustomers(data, true)[0];
        if (!controller.signal.aborted && normalized) {
          setPreviewDetails(current => ({ ...current, [previewId]: normalized.produtos_favoritos ?? [] }));
        }
      })
      .catch(() => { /* Preserve a neutral fallback when details cannot be read. */ })
      .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [step, previewId, previewRequiresProducts, previewCustomer?.produtos_favoritos, apiBaseUrl, authHeaders.Authorization]);

  const benefitOverrideLabel = useMemo(() => {
    if (tipoAbordagem === 'SEM_DESCONTO') return '';
    if (tipoAbordagem === 'CUPOM' && selectedCoupon) {
      const desc =
        selectedCoupon.tipo_desconto === 'porcentagem'
          ? `${selectedCoupon.valor_desconto}% OFF`
          : `R$ ${Number(selectedCoupon.valor_desconto).toFixed(2)} OFF`;
      const min =
        selectedCoupon.valor_minimo_pedido > 0
          ? ` (pedido mín. R$ ${Number(selectedCoupon.valor_minimo_pedido).toFixed(2)})`
          : '';
      return `o cupom ${selectedCoupon.codigo} com ${desc}${min}`;
    }
    return '';
  }, [tipoAbordagem, selectedCoupon]);

  const handleCreateQuickCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftCodigo.trim() || !draftValor) {
      showToast('Informe o código e o valor do cupom.', 'error');
      return;
    }
    try {
      setCreatingCoupon(true);
      const res = await fetch(`${apiBaseUrl}/caixa/cupons`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: draftCodigo.trim().toUpperCase(),
          tipo_desconto: draftTipo,
          valor_desconto: Number(draftValor),
          valor_minimo_pedido: draftMinimo ? Number(draftMinimo) : 0,
          limite_usos: null,
          valido_ate: null,
          apenas_primeira_compra: false,
          ativo: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Não foi possível criar o cupom.');
      }
      const created = await res.json();
      setCupons((prev) => [created, ...prev]);
      setSelectedCupomId(String(created.id));
      invalidateSavedCampaign();
      setShowQuickCouponDraft(false);
      showToast(`Cupom ${created.codigo} criado e vinculado à campanha!`);
    } catch (err: any) {
      showToast(err.message || 'Falha ao criar cupom.', 'error');
    } finally {
      setCreatingCoupon(false);
    }
  };

  const handleRegisterCampaign = async () => {
    if (savingCampaignRef.current) return;
    if (activeCampaignId) {
      setStep(3);
      return;
    }
    if (selectedCustomers.length === 0) {
      showToast('Selecione pelo menos um cliente antes de salvar.', 'error');
      return;
    }
    if (!nomeCampanha.trim()) {
      showToast('Informe um nome para identificar a campanha.', 'error');
      return;
    }
    if (tipoAbordagem === 'CUPOM' && !selectedCoupon) {
      showToast('Selecione um cupom ativo ou crie um rascunho antes de salvar.', 'error');
      return;
    }
    const draftGeneration = draftGenerationRef.current;
    savingCampaignRef.current = true;
    try {
      setSavingCampaign(true);
      const res = await fetch(`${apiBaseUrl}/fidelidade/crm/campanhas`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nomeCampanha.trim(),
          objetivo,
          abordagem_tipo: tipoAbordagem,
          segmento_filtro: objetivo,
          cupom_id: tipoAbordagem === 'CUPOM' ? selectedCupomId : null,
          template_mensagem: templateMensagem,
          total_elegiveis: selectedCustomers.length,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Não foi possível registrar a campanha.');
      }
      const data = await res.json();
      if (typeof data?.id !== 'string' || !data.id.trim()) {
        throw new Error('O servidor não confirmou o registro da campanha.');
      }
      if (draftGenerationRef.current !== draftGeneration) {
        showToast(
          'A versão anterior da campanha foi salva no histórico, mas você alterou o rascunho durante o salvamento. Salve a versão atual antes de registrar contatos.',
          'info',
        );
        return;
      }
      setActiveCampaignId(data.id);
      setRecordedCustomerIds({});
      setOpenedWhatsAppIds({});
      setStep(3);
      showToast('Campanha registrada! Use a fila abaixo para copiar ou abrir o WhatsApp individual e registrar cada ação.');
    } catch (err: any) {
      showToast(err.message || 'Erro ao salvar campanha.', 'error');
    } finally {
      savingCampaignRef.current = false;
      setSavingCampaign(false);
    }
  };

  const handleCopyMessage = async (customer: LoyaltyCustomer, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMessageIds(previous => ({ ...previous, [customer.id]: true }));
      showToast(`Mensagem para ${customer.cliente} copiada!`);
    } catch {
      showToast('Não foi possível copiar automaticamente. Selecione o texto manualmente.', 'info');
    }
  };

  const handleOpenWhatsApp = (customer: LoyaltyCustomer, text: string) => {
    const url = buildManualWhatsAppUrl(customer.telefone, text);
    if (!url) {
      showToast('Telefone inválido para abertura no WhatsApp.', 'error');
      return;
    }
    // Browser popup success is not proof of a delivered or even sent message.
    window.open(url, '_blank', 'noopener,noreferrer');
    setOpenedWhatsAppIds((prev) => ({ ...prev, [customer.id]: true }));
  };

  const handleConfirmManualContact = async (customer: LoyaltyCustomer, renderedMessage: string) => {
    const campaignId = activeCampaignId;
    if (!campaignId) {
      showToast('Salve a campanha antes de registrar contatos.', 'error');
      return;
    }
    if (pendingContactIdsRef.current.has(customer.id) || recordedCustomerIds[customer.id]) return;
    const draftGeneration = draftGenerationRef.current;
    pendingContactIdsRef.current.add(customer.id);
    try {
      setRecordingByCustomer((prev) => ({ ...prev, [customer.id]: true }));
      const beneficioResumo =
        tipoAbordagem === 'SEM_DESCONTO'
          ? 'Sem desconto (relacionamento)'
          : tipoAbordagem === 'CUPOM' && selectedCoupon
          ? `Cupom ${selectedCoupon.codigo}`
          : customer.beneficio_disponivel || 'Saldo de fidelidade';

      const res = await fetch(`${apiBaseUrl}/fidelidade/crm/contatos`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: customer.id,
          campanha_id: campaignId,
          objetivo,
          canal: 'WHATSAPP_MANUAL',
          abordagem_tipo: tipoAbordagem,
          acao_executada: 'CONTATO_MANUAL_CONFIRMADO',
          observacao: beneficioResumo,
          cupom_id: tipoAbordagem === 'CUPOM' ? selectedCupomId : null,
          cupom_codigo: tipoAbordagem === 'CUPOM' && selectedCoupon ? selectedCoupon.codigo : null,
          mensagem_personalizada: renderedMessage,
          confirmado_pelo_operador: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Não foi possível registrar o contato.');
      }
      const saved = await res.json();
      if (typeof saved?.id !== 'string' || !saved.id.trim()) {
        throw new Error('O servidor não confirmou o registro do contato.');
      }
      if (draftGenerationRef.current === draftGeneration) {
        setRecordedCustomerIds((prev) => ({ ...prev, [customer.id]: saved.id }));
        showToast(`Contato manual com ${customer.cliente} registrado no histórico!`);
      } else {
        showToast('Contato registrado na campanha anterior; o novo rascunho continua sem esse registro.', 'info');
      }
      await onRefreshCustomers();
    } catch (err: any) {
      showToast(err.message || 'Falha ao registrar contato.', 'error');
    } finally {
      pendingContactIdsRef.current.delete(customer.id);
      setRecordingByCustomer((prev) => ({ ...prev, [customer.id]: false }));
    }
  };

  const toggleCustomerSelection = (id: string) => {
    invalidateSavedCampaign();
    setSelectedCustomerIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  return (
    <div className="space-y-4 text-left animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 py-1">
        <div>
          <h3 className="text-lg font-bold text-koma-foreground">Prepare uma campanha</h3>

        </div>
          <button
            type="button"
            onClick={onOpenResults}
            className="koma-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
          >
            Ver acompanhamento em Resultados <ArrowRight size={13} />
          </button>
      </div>

      <nav aria-label="Etapas da campanha" className="grid grid-cols-3 gap-2">
        {([{id:1,label:'Público'},{id:2,label:'Mensagem'},{id:3,label:'Contatos'}] as const).map(item => (
          <button key={item.id} type="button" aria-current={step === item.id ? 'step' : undefined}
            disabled={item.id > 1 && selectedCustomers.length === 0 || item.id === 3 && !activeCampaignId}
            onClick={() => setStep(item.id)}
            className={`min-h-11 rounded-xl border px-2 py-3 text-sm font-bold disabled:opacity-40 ${step === item.id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-koma-border text-koma-muted'}`}>
            {item.id}. {item.label}
          </button>
        ))}
      </nav>
      <p role="status" className="text-sm text-koma-muted">{selectedCustomers.length} clientes selecionados · {tipoAbordagem === 'SEM_DESCONTO' ? 'Sem novo desconto' : tipoAbordagem === 'CUPOM' ? 'Com cupom' : 'Usando saldo de fidelidade'}</p>
      <div className="space-y-4">
        {/* Coluna Esquerda: Configuração da Ação (Etapas 1 a 4) */}
        <div className="space-y-4">
          {/* Etapa 1: Objetivo */}
          <section hidden={step !== 1} className="rounded-xl border border-koma-border bg-koma-panel p-3 sm:p-4 space-y-3">
            <h4 className="text-sm font-semibold text-koma-foreground">
              Objetivo
            </h4>
            <select aria-label="Objetivo da campanha" value={objetivo} onChange={e => handleObjectiveChange(e.target.value)} className="min-h-11 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-sm text-koma-foreground">
              {OBJECTIVES.map(obj => <option key={obj.id} value={obj.id}>{obj.label}</option>)}
            </select>
            <details className="text-xs text-koma-muted"><summary className="cursor-pointer">Como este público é selecionado</summary><p className="mt-2">{OBJECTIVES.find(obj => obj.id === objetivo)?.shortRule}</p></details>

            <div className="pt-1">
              <label className="block text-sm font-medium text-koma-muted">
                Nome da campanha
              </label>
              <input
                type="text"
                aria-label="Identificação da campanha"
                value={nomeCampanha}
                onChange={(e) => { invalidateSavedCampaign(); setNomeCampanha(e.target.value); }}
                className="mt-1 w-full rounded-xl border border-koma-border bg-koma-card px-3 py-2 text-sm text-koma-foreground"
              />
            </div>
          </section>

          {/* Etapa 2: Público */}
          <section hidden={step !== 1} className="rounded-xl border border-koma-border bg-koma-panel p-3 sm:p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-koma-foreground">
                Público selecionado ({selectedCustomers.length}{' '}
                {selectedCustomers.length === 1 ? 'cliente' : 'clientes'})
              </h4>
              <span className="text-xs text-koma-muted">
                Sem contatos repetidos
              </span>
            </div>

            {hasMoreCustomers && (
              <div role="status" className="rounded-lg border border-amber-500/30 p-3 text-sm text-koma-muted space-y-2">
                <p>A seleção automática considera {customers.length} de {totalCustomers} clientes carregados. Ela não representa necessariamente todos os elegíveis da base.</p>
                <div className="flex flex-wrap gap-2">
                  {currentOpportunity && authoritativeAudienceIds.length > 0 && (
                    <button type="button" disabled={audienceLoading} onClick={() => void loadCompleteOpportunityAudience()}
                      className="koma-btn-primary min-h-10 rounded-lg px-3 disabled:opacity-40">
                      {audienceLoading ? 'Consultando elegíveis…' : `Selecionar elegíveis do restaurante (${currentOpportunity.elegiveis_count ?? authoritativeAudienceIds.length})`}
                    </button>
                  )}
                  <button type="button" onClick={() => void onLoadMoreCustomers()} className="koma-btn-secondary min-h-10 rounded-lg px-3">Carregar mais clientes</button>
                  <button type="button" onClick={() => { invalidateSavedCampaign(); setSelectedCustomerIds(computeEligibleAudienceIds(objetivo)); }} className="koma-btn-secondary min-h-10 rounded-lg px-3">Recalcular seleção carregada</button>
                </div>
              </div>
            )}
            {audienceError && <p role="alert" className="text-sm text-amber-300">{audienceError}</p>}
            {selectedCustomers.length === 0 ? (
              <div className="rounded-xl border border-koma-border bg-koma-card p-3 text-sm text-koma-muted">
                Nenhum cliente elegível automaticamente para este objetivo no momento. Você pode selecionar clientes na aba{' '}
                <strong>Clientes</strong> ou escolher outro objetivo acima.
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                {selectedCustomers.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-koma-border bg-koma-card px-2.5 py-1 text-xs text-koma-foreground"
                  >
                    <button
                      type="button"
                      onClick={() => onInspectCustomer(c)}
                      className="font-semibold hover:underline"
                    >
                      {c.cliente}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remover ${c.cliente} do público`}
                      onClick={() => toggleCustomerSelection(c.id)}
                      className="text-koma-muted hover:text-rose-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {step === 1 && <button type="button" disabled={!selectedCustomers.length} onClick={() => setStep(2)} className="koma-btn-success min-h-11 w-full rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-40">Continuar para mensagem</button>}

          {/* Etapa 3: Abordagem / Benefício Opcional */}
          <section hidden={step !== 2} className="rounded-xl border border-koma-border bg-koma-panel p-3 sm:p-4 space-y-3">
            <h4 className="text-sm font-semibold text-koma-foreground">
              Quer oferecer algum benefício?
            </h4>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => handleApproachChange('SEM_DESCONTO')}
                className={`rounded-xl border p-3 text-left text-sm ${
                  tipoAbordagem === 'SEM_DESCONTO'
                    ? 'border-emerald-500 bg-emerald-500/10 text-koma-foreground'
                    : 'border-koma-border bg-koma-card text-koma-muted'
                }`}
              >
                <strong className="block text-koma-foreground">Sem desconto</strong>
                <span className="mt-1 block text-xs">
                  Convite pelo prato favorito, sem novo desconto.
                </span>
              </button>

              {hasLoyalty && (
                <button
                  type="button"
                  onClick={() => handleApproachChange('FIDELIDADE')}
                  className={`rounded-xl border p-3 text-left text-sm ${
                    tipoAbordagem === 'FIDELIDADE'
                      ? 'border-emerald-500 bg-emerald-500/10 text-koma-foreground'
                      : 'border-koma-border bg-koma-card text-koma-muted'
                  }`}
                >
                  <strong className="block text-koma-foreground">Saldo Fidelidade</strong>
                  <span className="mt-1 block text-xs">
                    Lembra pontos ou cashback já acumulados e prontos para resgate.
                  </span>
                </button>
              )}

              {hasCoupons && (
                <button
                  type="button"
                  onClick={() => handleApproachChange('CUPOM')}
                  className={`rounded-xl border p-3 text-left text-sm ${
                    tipoAbordagem === 'CUPOM'
                      ? 'border-emerald-500 bg-emerald-500/10 text-koma-foreground'
                      : 'border-koma-border bg-koma-card text-koma-muted'
                  }`}
                >
                  <strong className="block text-koma-foreground">Cupom rastreável</strong>
                  <span className="mt-1 block text-xs">
                    Vincula um cupom ativo para comprovar retorno nos resultados.
                  </span>
                </button>
              )}
            </div>

            {tipoAbordagem === 'CUPOM' && (
              <div className="rounded-xl border border-koma-border bg-koma-card p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-koma-muted">
                    Selecionar cupom ativo existente
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowQuickCouponDraft((prev) => !prev)}
                    className="text-xs font-bold text-emerald-400 hover:underline"
                  >
                    {showQuickCouponDraft ? 'Fechar rascunho' : '+ Preparar rascunho de cupom'}
                  </button>
                </div>

                {loadingCupons ? (
                  <p className="text-xs text-koma-muted">Carregando cupons ativos…</p>
                ) : (
                  <select
                    aria-label="Selecionar cupom da campanha"
                    value={selectedCupomId}
                    onChange={(e) => { invalidateSavedCampaign(); setSelectedCupomId(e.target.value); }}
                    className="w-full rounded-xl border border-koma-border bg-koma-panel px-3 py-2 text-sm text-koma-foreground"
                  >
                    <option value="">Selecione um cupom ativo…</option>
                    {activeCoupons.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.codigo} —{' '}
                        {c.tipo_desconto === 'porcentagem'
                          ? `${c.valor_desconto}% OFF`
                          : `R$ ${Number(c.valor_desconto).toFixed(2)} OFF`}{' '}
                        (Mín. R$ {Number(c.valor_minimo_pedido || 0).toFixed(2)})
                      </option>
                    ))}
                  </select>
                )}

                {selectedCoupon && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 text-xs text-koma-foreground">
                    <strong>Condições do cupom {selectedCoupon.codigo}:</strong>{' '}
                    {selectedCoupon.tipo_desconto === 'porcentagem'
                      ? `${selectedCoupon.valor_desconto}% de desconto`
                      : `R$ ${Number(selectedCoupon.valor_desconto).toFixed(2)} de desconto`}{' '}
                    · Pedido mínimo R$ {Number(selectedCoupon.valor_minimo_pedido || 0).toFixed(2)} · Usos:{' '}
                    {selectedCoupon.usos_atuais}/{selectedCoupon.limite_usos ?? 'Ilimitado'} · Canais: Cardápio Digital e Balcão.
                  </div>
                )}

                {showQuickCouponDraft && (
                  <form
                    onSubmit={handleCreateQuickCoupon}
                    className="rounded-xl border border-koma-border bg-koma-panel p-3 space-y-2.5"
                  >
                    <span className="block text-sm font-semibold text-emerald-400">
                      Rascunho de cupom com prévia de condições
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-koma-muted">Código</label>
                        <input
                          type="text"
                          value={draftCodigo}
                          onChange={(e) => setDraftCodigo(e.target.value.toUpperCase())}
                          className="mt-0.5 w-full rounded-lg border border-koma-border bg-koma-card px-2.5 py-1.5 font-mono text-xs text-koma-foreground uppercase"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-koma-muted">Tipo</label>
                        <select
                          value={draftTipo}
                          onChange={(e) => setDraftTipo(e.target.value as 'porcentagem' | 'fixo')}
                          className="mt-0.5 w-full rounded-lg border border-koma-border bg-koma-card px-2.5 py-1.5 text-xs text-koma-foreground"
                        >
                          <option value="porcentagem">Porcentagem (%)</option>
                          <option value="fixo">Valor fixo (R$)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-koma-muted">Desconto</label>
                        <input
                          type="number"
                          step="0.01"
                          value={draftValor}
                          onChange={(e) => setDraftValor(e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-koma-border bg-koma-card px-2.5 py-1.5 font-mono text-xs text-koma-foreground"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-koma-muted">Pedido mínimo (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={draftMinimo}
                          onChange={(e) => setDraftMinimo(e.target.value)}
                          className="mt-0.5 w-full rounded-lg border border-koma-border bg-koma-card px-2.5 py-1.5 font-mono text-xs text-koma-foreground"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-koma-muted">
                      Prévia: Cupom <strong>{draftCodigo || 'CODIGO'}</strong> dará{' '}
                      {draftTipo === 'porcentagem' ? `${draftValor || 0}% OFF` : `R$ ${draftValor || 0} OFF`} em pedidos acima de R${' '}
                      {draftMinimo || 0} no Cardápio Digital e Balcão.
                    </p>
                    <button
                      type="submit"
                      disabled={creatingCoupon}
                      className="koma-btn-primary w-full rounded-lg py-1.5 text-xs font-bold"
                    >
                      {creatingCoupon ? 'Criando cupom…' : 'Ativar cupom e vincular à campanha'}
                    </button>
                  </form>
                )}
              </div>
            )}
          </section>

          {/* Etapa 4: Mensagem editável com variáveis seguras */}
          <section hidden={step !== 2} className="rounded-xl border border-koma-border bg-koma-panel p-3 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-koma-foreground">
                Revise a mensagem
              </h4>
              <div className="flex flex-wrap gap-1">
                {(['{nome}', '{produto_favorito}', '{beneficio}'] as const).map((token) => (
                  <button
                    key={token}
                    type="button"
                    onClick={() => { invalidateSavedCampaign(); setTemplateMensagem((prev) => `${prev} ${token}`); }}
                    className="rounded-md border border-koma-border bg-koma-card px-2 py-0.5 font-mono text-xs text-emerald-400 hover:bg-koma-raised"
                  >
                    + {token}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              rows={4}
              aria-label="Modelo de mensagem da campanha"
              value={templateMensagem}
              onChange={(e) => { invalidateSavedCampaign(); setTemplateMensagem(e.target.value); }}
              className="w-full rounded-xl border border-koma-border bg-koma-card p-3 text-sm text-koma-foreground leading-relaxed"
            />

            <details className="rounded-xl border border-koma-border bg-koma-card p-2.5 text-xs text-koma-muted space-y-1">
              <summary className="cursor-pointer font-bold text-koma-foreground">Como a mensagem é personalizada</summary>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>
                  <code>{'{nome}'}</code> → Primeiro nome conhecido ou saudação neutra (<em>“Oi, tudo bem?”</em>).
                </li>
                <li>
                  <code>{'{produto_favorito}'}</code> → Item mais pedido sem cancelamento ou{' '}
                  <em>“seu prato preferido da casa”</em>.
                </li>
                <li>
                  <code>{'{beneficio}'}</code> → Cupom selecionado, saldo resgatável real ou{' '}
                  <em>“uma condição especial para o seu próximo pedido”</em>.
                </li>
              </ul>
            </details>

            {previewCustomer && (
              <div className="rounded-xl border border-koma-border bg-koma-card p-3 space-y-2">
                <label className="block text-sm font-medium text-koma-muted" htmlFor="crm-preview-customer">
                  Prévia da mensagem
                </label>
                <select id="crm-preview-customer" value={previewCustomer.id}
                  onChange={event => setPreviewCustomerId(event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-koma-border bg-koma-panel px-3 text-sm text-koma-foreground">
                  {selectedCustomers.map(customer => <option key={customer.id} value={customer.id}>{customer.cliente}</option>)}
                </select>
                <p className="whitespace-pre-wrap text-sm text-koma-foreground" aria-label="Prévia personalizada">
                  {interpolateCrmTemplate(templateMensagem, previewCustomer, benefitOverrideLabel)}
                </p>
                {previewLoading && <p role="status" className="text-xs text-koma-muted">Consultando favorito deste cliente…</p>}
                {templateMensagem.includes('{produto_favorito}') && previewCustomer.produtos_favoritos === undefined && (
                  <p className="text-xs text-amber-300">Favorito não consultado · mensagem sem preferência presumida.</p>
                )}
              </div>
            )}
            <p className="text-xs text-koma-muted">
              Salvar não envia mensagens. Confirme cada contato após o envio.
            </p>
            <button
              type="button"
              disabled={savingCampaign || selectedCustomers.length === 0}
              onClick={handleRegisterCampaign}
              className="koma-btn-success w-full rounded-xl py-2.5 text-xs font-bold disabled:opacity-40"
            >
              {savingCampaign
                ? 'Salvando campanha…'
                : activeCampaignId
                ? 'Voltar aos contatos da campanha salva'
                : 'Salvar e revisar contatos'}
            </button>
          </section>
        </div>

        {/* Coluna Direita: Etapa 5 — Revisão, Prévia Individual e Registro Manual */}
        <div hidden={step !== 3} className="space-y-4">
          <p role="status" className="text-sm text-koma-muted">
            {selectedCustomers.filter(c => recordedCustomerIds[c.id]).length} contatos registrados manualmente de {selectedCustomers.length} selecionados nesta sessão.
          </p>
          <section className="rounded-xl border border-koma-border bg-koma-panel p-3 sm:p-4 space-y-3">
            <div className="border-b border-koma-border pb-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-koma-foreground">
                  Revise e contate cada cliente
                </h4>
                {activeCampaignId && (
                  <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold text-emerald-300">
                    Campanha salva
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-amber-300/90">
                Abrir o WhatsApp <strong>não comprova envio</strong>. Registre o contato somente após enviar a mensagem.
              </p>
            </div>

            {selectedCustomers.length === 0 ? (
              <div className="rounded-xl border border-koma-border bg-koma-card p-6 text-center text-xs text-koma-muted">
                Selecione uma oportunidade na aba <strong>Hoje</strong> ou escolha um objetivo com clientes elegíveis para liberar a fila individual.
              </div>
            ) : (
              <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">
                {selectedCustomers.map((customer) => {
                  const previewText = interpolateCrmTemplate(
                    templateMensagem,
                    customer,
                    benefitOverrideLabel,
                  );
                  const waUrl = buildManualWhatsAppUrl(customer.telefone, previewText);
                  const isRecorded = Boolean(recordedCustomerIds[customer.id]);
                  const isRecording = Boolean(recordingByCustomer[customer.id]);
                  const wasOpened = Boolean(openedWhatsAppIds[customer.id]);

                  return (
                    <article
                      key={customer.id}
                      className="rounded-2xl border border-koma-border bg-koma-card p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <strong className="text-xs font-bold text-koma-foreground">
                            {customer.cliente}
                          </strong>
                          <span className="ml-2 font-mono text-xs text-koma-muted">
                            {customer.telefone || 'Sem telefone'}
                          </span>
                          <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-koma-muted">
                            <span>{customer.pedidos_concluidos ?? 0} compras</span>
                            {customer.dias_sem_comprar != null && (
                              <span>· há {customer.dias_sem_comprar} dias sem comprar</span>
                            )}
                            {customer.status_beneficio === 'SALDO_EM_FORMACAO' && (
                              <span className="text-amber-300">
                                · Saldo em formação ({customer.pontos} pts — ainda não resgatável)
                              </span>
                            )}
                          </div>
                        </div>

                        {isRecorded ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-bold text-emerald-300">
                            <CheckCircle2 size={12} /> Registro manual confirmado
                          </span>
                        ) : customer.contato_recente ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-300">
                            Contato recente ({customer.dias_desde_ultimo_contato ?? 0}d)
                          </span>
                        ) : wasOpened ? (
                          <span className="text-xs text-koma-muted">WhatsApp solicitado · envio não confirmado</span>
                        ) : copiedMessageIds[customer.id] ? (
                          <span className="text-xs text-koma-muted">Mensagem copiada · envio não confirmado</span>
                        ) : (
                          <span className="text-xs text-koma-muted">Selecionado · contato pendente</span>
                        )}
                      </div>

                      <div className="rounded-xl border border-koma-border bg-koma-panel p-2.5 text-xs text-koma-foreground leading-relaxed">
                        {previewText}
                      </div>

                      {!waUrl && (
                        <p className="text-xs text-rose-400">
                          Telefone inválido para abrir conversa no WhatsApp. Corrija o cadastro antes de abordar.
                        </p>
                      )}

                      {wasOpened && !isRecorded && (
                        <p className="text-xs text-amber-300">
                          Abertura do WhatsApp solicitada. Isso não comprova envio; confirme abaixo apenas depois de enviar a mensagem.
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => void handleCopyMessage(customer, previewText)}
                          className="koma-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold"
                        >
                          <Copy size={12} /> Copiar mensagem
                        </button>

                        <button
                          type="button"
                          disabled={!waUrl || Boolean(customer.opt_out_marketing)}
                          onClick={() => handleOpenWhatsApp(customer, previewText)}
                          className="koma-btn-secondary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                        >
                          <ExternalLink size={12} /> Abrir WhatsApp
                        </button>

                        <button
                          type="button"
                          disabled={
                            isRecording ||
                            isRecorded ||
                            !activeCampaignId ||
                            !waUrl ||
                            Boolean(customer.opt_out_marketing) ||
                            Boolean(customer.contato_recente)
                          }
                          onClick={() => void handleConfirmManualContact(customer, previewText)}
                          className="koma-btn-primary inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold disabled:opacity-40"
                        >
                          <Send size={12} />
                          {isRecorded
                            ? 'Contato manual registrado'
                            : isRecording
                            ? 'Registrando…'
                            : 'Registrar contato manual'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
