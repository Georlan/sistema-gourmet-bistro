import { customerBenefitDescription } from '../../../domain/customerBenefit';
import { snapshotFetch as fetch } from '../../../utils/snapshotFetch';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoyaltyCustomer } from '../cashierContracts';

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
};

type CustomerSnapshot = {
  scope: string;
  totalCount: number;
  hasMore: boolean;
  data: LoyaltyCustomer[];
  status: 'loading' | 'ready' | 'refreshing' | 'error';
  hasSnapshot: boolean;
};

export function mapCustomers(clientes: any[], productsIncluded: boolean): LoyaltyCustomer[] {
  return clientes
          .filter((c: any) => c?.id != null && String(c.id).trim() !== '')
    .map((c: any) => ({
            id: String(c.id),
            cliente: c.nome || c.cliente || 'Cliente',
            nome: c.nome || c.cliente || 'Cliente',
            telefone: c.telefone || '',
            endereco: c.endereco || '',
            pontos: Number(c.saldo_pontos || 0),
            saldo_pontos: Number(c.saldo_pontos || 0),
            saldoCashback: Number(c.saldo_cashback || 0),
            saldo_cashback: Number(c.saldo_cashback || 0),
            historico: c.historico || [],
            produtos_favoritos: productsIncluded && Array.isArray(c.produtos_favoritos) ? c.produtos_favoritos : undefined,
            pedidos_concluidos: typeof c.pedidos_concluidos === 'number' ? c.pedidos_concluidos : 0,
            valor_pago_total: typeof c.valor_pago_total === 'number' ? c.valor_pago_total : 0,
            ticket_medio_pago: typeof c.ticket_medio_pago === 'number' ? c.ticket_medio_pago : 0,
            primeira_compra_em: c.primeira_compra_em ?? null,
            intervalo_medio_dias: c.intervalo_medio_dias ?? null,
            ultima_compra_em: c.ultima_compra_em ?? null,
            dias_sem_comprar: typeof c.dias_sem_comprar === 'number' ? c.dias_sem_comprar : null,
            segmento_relacionamento: c.segmento_relacionamento || 'SEM_COMPRA',
            telefone_valido_whatsapp: Boolean(c.telefone_valido_whatsapp),
            opt_out_marketing: Boolean(c.opt_out_marketing),
            motivo_opt_out: c.motivo_opt_out ?? null,
            canal_preferido: c.canal_preferido || 'WHATSAPP',
            observacoes_declaradas: c.observacoes_declaradas ?? null,
            ultimo_contato_em: c.ultimo_contato_em ?? null,
            ultimo_contato_status: c.ultimo_contato_status ?? null,
            ultimo_contato_objetivo: c.ultimo_contato_objetivo ?? null,
            dias_desde_ultimo_contato: typeof c.dias_desde_ultimo_contato === 'number' ? c.dias_desde_ultimo_contato : null,
            total_contatos_crm: typeof c.total_contatos_crm === 'number' ? c.total_contatos_crm : 0,
            contato_recente: Boolean(c.contato_recente),
            voltou_apos_ultimo_contato: Boolean(c.voltou_apos_ultimo_contato),
            ultima_avaliacao_nota: typeof c.ultima_avaliacao_nota === 'number' ? c.ultima_avaliacao_nota : null,
            ultima_avaliacao_comentario: c.ultima_avaliacao_comentario ?? null,
            ocorrencia_aberta: Boolean(c.ocorrencia_aberta),
            beneficio_disponivel: customerBenefitDescription(c.beneficio_disponivel),
            elegivel_resgate: Boolean(c.elegivel_resgate),
            valor_resgatavel_brl: typeof c.valor_resgatavel_brl === 'number' ? c.valor_resgatavel_brl : 0,
            status_beneficio: c.status_beneficio || 'SEM_SALDO',
    }));
}

export function useCashierCustomers({ apiBaseUrl, authHeaders }: Props) {
  const authorization = authHeaders.Authorization || authHeaders.authorization || '';
  const scope = `${apiBaseUrl}\u0000${authorization}`;
  const [snapshot, setSnapshot] = useState<CustomerSnapshot>({ scope, data: [], status: 'loading', hasSnapshot: false, totalCount: 0, hasMore: false });
  const scopeRef = useRef(scope);
  const mountedRef = useRef(false);
  const flightRef = useRef<Promise<void> | null>(null);
  const dirtyRef = useRef(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const moreControllerRef = useRef<AbortController | null>(null);
  const moreFlightRef = useRef<Promise<void> | null>(null);
  const [loadingMoreCustomers, setLoadingMoreCustomers] = useState(false);
  const current = snapshot.scope === scope ? snapshot : { scope, data: [], status: 'loading' as const, hasSnapshot: false, totalCount: 0, hasMore: false };

  const loadCustomers = useCallback((): Promise<void> => {
    if (scopeRef.current !== scope) {
      scopeRef.current = scope;
      controllerRef.current?.abort();
      moreControllerRef.current?.abort();
      moreFlightRef.current = null;
      flightRef.current = null;
      dirtyRef.current = false;
      setSnapshot({ scope, data: [], status: 'loading', hasSnapshot: false, totalCount: 0, hasMore: false });
    }
    if (flightRef.current) return flightRef.current;
    setSnapshot(previous => ({ ...previous, status: previous.hasSnapshot ? 'refreshing' : 'loading' }));
    const controller = new AbortController();
    controllerRef.current = controller;
    const flight = (async () => {
    try {
      // O backend aplica autenticação, tenant e RLS antes de devolver as fichas.
      const response = await fetch(`${apiBaseUrl}/fidelidade/clientes?sort=orders`, {
        headers: authHeaders,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar clientes (${response.status})`);
      }
      const clientes = await response.json();
      if (Array.isArray(clientes)) {
        const mapped = mapCustomers(clientes, response.headers.get('X-Products-Included') !== 'false');
        if (mountedRef.current && scopeRef.current === scope) {
          setSnapshot({ scope, data: mapped, status: 'ready', hasSnapshot: true,
            totalCount: Number(response.headers.get('X-Total-Count')) || mapped.length,
            hasMore: response.headers.get('X-Has-More') === 'true',
          });
        }
        return;
      }
      throw new Error('Resposta inválida ao carregar clientes');
    } catch (error) {
      if (!controller.signal.aborted && mountedRef.current && scopeRef.current === scope) {
        setSnapshot(previous => ({ ...previous, status: 'error' }));
        console.error('Error fetching loyalty clients from API:', error);
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (scopeRef.current === scope) {
        flightRef.current = null;
        if (dirtyRef.current && mountedRef.current) {
          dirtyRef.current = false;
          queueMicrotask(() => { void loadCustomers(); });
        }
      }
    }
    })();
    flightRef.current = flight;
    return flight;
  }, [apiBaseUrl, authorization, scope]);

  // Extra pages are fetched only on explicit request. A partial snapshot is never called the entire base.
  const loadMoreCustomers = useCallback((): Promise<void> => {
    if (current.scope !== scope || !current.hasMore || moreFlightRef.current) {
      return moreFlightRef.current ?? Promise.resolve();
    }
    const offset = current.data.length;
    const controller = new AbortController();
    moreControllerRef.current = controller;
    const flight = (async () => {
      setLoadingMoreCustomers(true);
      try {
        const response = await fetch(`${apiBaseUrl}/fidelidade/clientes?sort=orders&limit=100&offset=${offset}`, {
          headers: authHeaders, signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Falha ao carregar mais clientes (${response.status})`);
        const json = await response.json();
        if (!Array.isArray(json)) throw new Error('Resposta inválida de paginação de clientes');
        const next = mapCustomers(json, response.headers.get('X-Products-Included') !== 'false');
        if (mountedRef.current && scopeRef.current === scope) {
          setSnapshot(previous => {
            if (previous.scope !== scope) return previous;
            const existing = new Set(previous.data.map(customer => customer.id));
            const additional = next.filter(customer => !existing.has(customer.id));
            const data = [...previous.data, ...additional];
            const totalCount = Number(response.headers.get('X-Total-Count')) || previous.totalCount;
            return { ...previous, data, totalCount,
              hasMore: response.headers.get('X-Has-More') === 'true',
            };
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error('Error loading next customer page:', error);
      } finally {
        if (moreControllerRef.current === controller) moreControllerRef.current = null;
        moreFlightRef.current = null;
        if (mountedRef.current) setLoadingMoreCustomers(false);
      }
    })();
    moreFlightRef.current = flight;
    return flight;
  }, [apiBaseUrl, authHeaders, current, scope]);

  const refreshLoyaltyUsers = useCallback((): Promise<void> => {
    if (flightRef.current) {
      dirtyRef.current = true;
      return flightRef.current;
    }
    return loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    mountedRef.current = true;
    void loadCustomers();

    const handleCustomerEvent = () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      hintTimerRef.current = setTimeout(() => {
        hintTimerRef.current = null;
        if (flightRef.current) dirtyRef.current = true;
        else void loadCustomers();
      }, 75);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'koma_customers_updated') handleCustomerEvent();
    };
    window.addEventListener('koma_customers_updated', handleCustomerEvent);
    window.addEventListener('storage', handleStorage);

    return () => {
      mountedRef.current = false;
      moreControllerRef.current?.abort();
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
      window.removeEventListener('koma_customers_updated', handleCustomerEvent);
      window.removeEventListener('storage', handleStorage);
    };
  }, [loadCustomers]);

  return {
    loyaltyUsers: current.data,
    totalCustomers: current.totalCount,
    hasMoreCustomers: current.hasMore,
    loadingMoreCustomers,
    loadMoreCustomers,
    customersStatus: current.status,
    hasCustomerSnapshot: current.hasSnapshot,
    refreshLoyaltyUsers,
  };
}
