import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  ShoppingCart,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  getSellableProducts,
  normalizeCatalogSnapshot,
  type CatalogCategory,
  type CatalogProduct,
  type CatalogSnapshot,
} from '../catalog/catalog';
import { API_BASE_URL, WS_BASE_URL } from '../config/api';
import { getIngredientObservationPresets, normalizeText } from '../domain';
import type { SmartPosSession } from './smartPosSession';
import { makeOperationKey, operationalFetch } from '../utils/operationalRequest';
import { openAuthenticatedWebSocket } from '../utils/authenticatedWebSocket';

type MesaResumo = {
  id: number;
  nome?: string | null;
};

type ComandaResumo = {
  id: string;
  numero_pedido: number;
  identificador?: string | null;
};

type ObservacaoPredefinida = {
  id: number;
  categoria_id: string;
  texto: string;
};

type CartLine = {
  productId: string;
  quantity: number;
  observationIds: number[];
  ingredientObservations: string[];
  customObservation: string;
};

type OrderingView = 'categories' | 'products' | 'review';

interface SmartPosOrderingFlowProps {
  session: SmartPosSession;
  mesa?: MesaResumo;
  comandas?: ComandaResumo[];
  mode?: 'table' | 'quick-sale';
  onCancel: () => void;
  cancelLabel?: string;
  onSessionInvalid: () => void;
  onOrderCreated?: () => Promise<void> | void;
  onQuickSaleCreated?: (sale: {
    id: string;
    numeroPedido: number;
    total: number;
  }) => Promise<void> | void;
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
}

function categoryLabel(category: CatalogCategory) {
  return category.nome || 'Categoria';
}

export default function SmartPosOrderingFlow({
  session,
  mesa,
  comandas = [],
  mode = 'table',
  onCancel,
  cancelLabel = 'Voltar para a mesa',
  onSessionInvalid,
  onOrderCreated,
  onQuickSaleCreated,
}: SmartPosOrderingFlowProps) {
  const [catalog, setCatalog] = useState<CatalogSnapshot>({ categorias: [], produtos: [] });
  const [observations, setObservations] = useState<ObservacaoPredefinida[]>([]);
  const [view, setView] = useState<OrderingView>('categories');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [targetComandaId, setTargetComandaId] = useState<string>(() => comandas[0]?.id || 'new');
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const pendingSubmitRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const isQuickSale = mode === 'quick-sale';
  const destinationLabel = isQuickSale
    ? 'Venda rápida'
    : (mesa?.nome || (mesa ? `Mesa ${mesa.id}` : 'Mesa'));

  const authHeaders = useMemo(() => ({
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  }), [session.token]);

  const loadCatalog = useCallback(async (silent = false) => {
    if (!silent) setIsLoadingCatalog(true);
    setCatalogError('');
    try {
      const [catalogResponse, observationsResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/produtos/catalogo`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: 'no-store',
        }),
        fetch(`${API_BASE_URL}/produtos/observacoes`, {
          headers: { Authorization: `Bearer ${session.token}` },
          cache: 'no-store',
        }),
      ]);

      if (catalogResponse.status === 401 || observationsResponse.status === 401) {
        onSessionInvalid();
        return;
      }
      if (!catalogResponse.ok || !observationsResponse.ok) {
        throw new Error('Não foi possível atualizar o cardápio agora.');
      }

      const catalogPayload = await catalogResponse.json();
      const observationsPayload = await observationsResponse.json();
      setCatalog(normalizeCatalogSnapshot(catalogPayload));
      setObservations(Array.isArray(observationsPayload) ? observationsPayload : []);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Falha ao carregar o cardápio.');
    } finally {
      if (!silent) setIsLoadingCatalog(false);
    }
  }, [onSessionInvalid, session.token]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = () => {
      if (stopped) return;
      const wsUrl = `${WS_BASE_URL}/ws/${encodeURIComponent(session.user.id)}`;
      socket = openAuthenticatedWebSocket(wsUrl, session.token);

      socket.onopen = () => {
        if (!stopped) setIsRealtimeConnected(true);
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const eventName = data.event || data.type;
          if (eventName === 'catalog_updated') {
            void loadCatalog(true);
          }
        } catch {
          // Mensagens desconhecidas não devem interromper o fluxo de pedido.
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setIsRealtimeConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();
    return () => {
      stopped = true;
      setIsRealtimeConnected(false);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket) {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
    };
  }, [loadCatalog, session.token, session.user.id]);

  useEffect(() => {
    if (isRealtimeConnected) return;
    const interval = setInterval(() => void loadCatalog(true), 40000);
    return () => clearInterval(interval);
  }, [isRealtimeConnected, loadCatalog]);

  const sellableProducts = useMemo(
    () => getSellableProducts(catalog.produtos),
    [catalog.produtos],
  );

  const productById = useMemo(
    () => new Map(catalog.produtos.map((product) => [product.id, product])),
    [catalog.produtos],
  );

  const categories = useMemo(() => catalog.categorias
    .map((category) => ({
      category,
      products: sellableProducts.filter((product) => product.categoria_id === category.id),
    }))
    .filter((entry) => entry.products.length > 0), [catalog.categorias, sellableProducts]);

  const selectedCategory = catalog.categorias.find((category) => category.id === selectedCategoryId) || null;
  const selectedProducts = sellableProducts.filter((product) => product.categoria_id === selectedCategoryId);

  const cartLines = useMemo(() => Object.values(cart), [cart]);
  const totalUnits = cartLines.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cartLines.reduce((sum, line) => {
    const product = productById.get(line.productId);
    return sum + (product ? Number(product.preco || 0) * line.quantity : 0);
  }, 0);
  const unavailableProducts = cartLines.filter((line) => {
    const product = productById.get(line.productId);
    return !product || product.ativo === false;
  });

  const addProduct = (product: CatalogProduct) => {
    setCart((current) => {
      const existing = current[product.id];
      return {
        ...current,
        [product.id]: existing
          ? { ...existing, quantity: existing.quantity + 1 }
          : {
              productId: product.id,
              quantity: 1,
              observationIds: [],
              ingredientObservations: [],
              customObservation: '',
            },
      };
    });
  };

  const changeQuantity = (productId: string, delta: number) => {
    setCart((current) => {
      const line = current[productId];
      if (!line) return current;
      const quantity = line.quantity + delta;
      if (quantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }
      return { ...current, [productId]: { ...line, quantity } };
    });
  };

  const toggleObservation = (productId: string, observationId: number) => {
    setCart((current) => {
      const line = current[productId];
      if (!line) return current;
      const selected = line.observationIds.includes(observationId);
      return {
        ...current,
        [productId]: {
          ...line,
          observationIds: selected
            ? line.observationIds.filter((id) => id !== observationId)
            : [...line.observationIds, observationId],
        },
      };
    });
  };

  const toggleIngredientObservation = (productId: string, text: string) => {
    setCart((current) => {
      const line = current[productId];
      if (!line) return current;
      const selectedObservations = line.ingredientObservations || [];
      const selected = selectedObservations.includes(text);
      return {
        ...current,
        [productId]: {
          ...line,
          ingredientObservations: selected
            ? selectedObservations.filter((observation) => observation !== text)
            : [...selectedObservations, text],
        },
      };
    });
  };

  const updateCustomObservation = (productId: string, value: string) => {
    setCart((current) => {
      const line = current[productId];
      if (!line) return current;
      return {
        ...current,
        [productId]: { ...line, customObservation: value.slice(0, 180) },
      };
    });
  };

  const goBack = () => {
    if (view === 'review') {
      setView(selectedCategoryId ? 'products' : 'categories');
      return;
    }
    if (view === 'products') {
      setSelectedCategoryId(null);
      setView('categories');
      return;
    }
    onCancel();
  };

  const targetLabel = useMemo(() => {
    if (isQuickSale) return 'Balcão';
    if (targetComandaId === 'new') {
      return comandas.length > 0 ? `Cliente ${comandas.length + 1}` : 'Consumo Geral';
    }
    const target = comandas.find((comanda) => comanda.id === targetComandaId);
    return target?.identificador || 'Consumo Geral';
  }, [comandas, isQuickSale, targetComandaId]);

  const buildObservation = (line: CartLine) => {
    const selected = line.observationIds
      .map((id) => observations.find((observation) => observation.id === id)?.texto)
      .filter((value): value is string => Boolean(value));
    const custom = line.customObservation.trim();
    return [...selected, ...(line.ingredientObservations || []), ...(custom ? [custom] : [])].join(', ');
  };

  const submitOrder = async () => {
    if (isSubmitting || cartLines.length === 0 || unavailableProducts.length > 0) return;
    setIsSubmitting(true);
    setSubmitError('');

    try {
      const items = cartLines.flatMap((line) => {
        const observation = buildObservation(line);
        return Array.from({ length: line.quantity }, () => ({
          produto_id: line.productId,
          observacao: observation,
          cliente_nome: targetLabel,
        }));
      });
      const submitFingerprint = JSON.stringify({
        mode,
        mesaId: mesa?.id || null,
        targetComandaId,
        items,
      });
      if (pendingSubmitRef.current?.fingerprint !== submitFingerprint) {
        pendingSubmitRef.current = {
          fingerprint: submitFingerprint,
          key: makeOperationKey(isQuickSale ? 'smartpos-sale' : 'smartpos-launch'),
        };
      }
      const submitIdempotencyKey = pendingSubmitRef.current.key;

      if (isQuickSale) {
        const saleResponse = await operationalFetch(`${API_BASE_URL}/comandas/venda-direta`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            mesa_id: null,
            garcom_id: session.user.id,
            tipo: 'Balcão',
            origem: 'smartpos',
            idempotency_key: submitIdempotencyKey,
            itens: items,
          }),
        });
        if (saleResponse.status === 401) {
          onSessionInvalid();
          return;
        }
        const sale = await saleResponse.json().catch(() => null);
        if (!saleResponse.ok || !sale?.id) {
          throw new Error(sale?.detail || 'Não foi possível criar a venda rápida.');
        }
        const confirmedTotal = Array.isArray(sale.itens)
          ? sale.itens
              .filter((item: { status?: string }) => item.status !== 'cancelado')
              .reduce((sum: number, item: { preco_unit?: number }) => sum + Number(item.preco_unit || 0), 0)
          : cartTotal;
        setCart({});
        pendingSubmitRef.current = null;
        await onQuickSaleCreated?.({
          id: String(sale.id),
          numeroPedido: Number(sale.numero_pedido),
          total: confirmedTotal,
        });
        return;
      }

      if (!mesa) {
        throw new Error('A mesa desta operação não está disponível.');
      }
      let comandaId = targetComandaId !== 'new' ? targetComandaId : null;

      if (!comandaId) {
        const identifier = comandas.length > 0 ? `Cliente ${comandas.length + 1}` : null;
        const openResponse = await operationalFetch(`${API_BASE_URL}/comandas/`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            mesa_id: mesa.id,
            garcom_id: session.user.id,
            tipo: 'Consumo no Local',
            identificador: identifier,
          }),
        });
        if (openResponse.status === 401) {
          onSessionInvalid();
          return;
        }
        const opened = await openResponse.json().catch(() => null);
        if (!openResponse.ok || !opened?.id) {
          throw new Error(opened?.detail || 'Não foi possível abrir a comanda desta mesa.');
        }
        comandaId = String(opened.id);
      }

      const launchResponse = await operationalFetch(`${API_BASE_URL}/comandas/${encodeURIComponent(comandaId)}/lancamentos`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          garcom_id: session.user.id,
          origem: 'smartpos',
          idempotency_key: submitIdempotencyKey,
          itens: items,
        }),
      });
      if (launchResponse.status === 401) {
        onSessionInvalid();
        return;
      }
      const result = await launchResponse.json().catch(() => null);
      if (!launchResponse.ok) {
        throw new Error(result?.detail || 'Não foi possível confirmar o pedido.');
      }

      setCart({});
      pendingSubmitRef.current = null;
      await onOrderCreated?.();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Falha ao confirmar o pedido.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const cartBar = totalUnits > 0 && view !== 'review' ? (
    <button
      type="button"
      onClick={() => setView('review')}
      className="sticky bottom-3 mt-5 flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl bg-koma-accent px-4 py-3 text-left text-black shadow-lg"
    >
      <span className="flex items-center gap-2 text-sm font-black"><ShoppingCart size={18} /> {totalUnits} {totalUnits === 1 ? 'item' : 'itens'}</span>
      <span className="flex items-center gap-2 text-sm font-black">{money(cartTotal)} <ChevronRight size={17} /></span>
    </button>
  ) : null;

  if (isLoadingCatalog) {
    return <div className="flex min-h-[55vh] items-center justify-center gap-3 text-sm text-koma-muted"><Loader2 size={20} className="animate-spin text-koma-accent" /> Carregando cardápio…</div>;
  }

  if (catalogError && catalog.produtos.length === 0) {
    return (
      <section className="pt-6">
        <button type="button" onClick={goBack} className="mb-5 flex items-center gap-2 text-xs font-bold text-koma-muted"><ArrowLeft size={16} /> {cancelLabel}</button>
        <div className="rounded-2xl border border-red-900/50 bg-red-950/20 p-5">
          <p className="text-sm font-black text-red-300">Cardápio indisponível</p>
          <p className="mt-2 text-xs leading-5 text-koma-muted">{catalogError}</p>
          <button type="button" onClick={() => void loadCatalog()} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-koma-border px-4 text-xs font-bold"><RefreshCw size={15} /> Tentar novamente</button>
        </div>
      </section>
    );
  }

  if (view === 'review') {
    return (
      <section className="pb-5 pt-6">
        <button type="button" onClick={goBack} className="mb-4 flex items-center gap-2 text-xs font-bold text-koma-muted"><ArrowLeft size={16} /> Continuar escolhendo</button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Revisar pedido</p>
            <h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{destinationLabel}</h1>
          </div>
          <span className="flex items-center gap-1 rounded-full border border-koma-border px-2 py-1 text-[9px] font-bold uppercase text-koma-muted">
            {isRealtimeConnected ? <Wifi size={11} className="text-koma-accent" /> : <WifiOff size={11} />} catálogo
          </span>
        </div>

        {!isQuickSale && comandas.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-koma-muted">Adicionar em</p>
            <div className="grid grid-cols-2 gap-2">
              {comandas.map((comanda, index) => (
                <button key={comanda.id} type="button" onClick={() => setTargetComandaId(comanda.id)} className={`min-h-12 rounded-xl border px-3 text-left text-xs font-bold ${targetComandaId === comanda.id ? 'border-koma-accent bg-koma-accent/10 text-koma-foreground' : 'border-koma-border bg-koma-surface text-koma-muted'}`}>
                  {comanda.identificador || (index === 0 ? 'Conta principal' : `Pedido #${comanda.numero_pedido}`)}
                </button>
              ))}
              <button type="button" onClick={() => setTargetComandaId('new')} className={`min-h-12 rounded-xl border px-3 text-left text-xs font-bold ${targetComandaId === 'new' ? 'border-koma-accent bg-koma-accent/10 text-koma-foreground' : 'border-koma-border bg-koma-surface text-koma-muted'}`}>
                + Nova comanda
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-3">
          {cartLines.map((line) => {
            const product = productById.get(line.productId);
            if (!product) {
              return <div key={line.productId} className="rounded-2xl border border-red-900/50 bg-red-950/20 p-4 text-xs text-red-300">Este produto não está mais disponível. Remova-o para continuar.</div>;
            }
            const ingredientObservations = getIngredientObservationPresets(product);
            const ingredientObservationKeys = new Set(ingredientObservations.map(normalizeText));
            const categoryObservations = observations.filter((observation) => (
              observation.categoria_id === product.categoria_id
              && !ingredientObservationKeys.has(normalizeText(observation.texto))
            ));
            return (
              <article key={line.productId} className={`rounded-2xl border bg-koma-surface p-4 ${product.ativo === false ? 'border-red-900/60' : 'border-koma-border'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-sm font-black">{product.nome}</p><p className="mt-1 text-xs text-koma-muted">{money(Number(product.preco || 0))} cada</p>{product.ativo === false && <p className="mt-1 text-[10px] font-bold uppercase text-red-300">Indisponível agora</p>}</div>
                  <div className="flex items-center rounded-xl border border-koma-border bg-koma-page p-1">
                    <button type="button" onClick={() => changeQuantity(product.id, -1)} className="flex size-9 items-center justify-center rounded-lg text-koma-muted"><Minus size={15} /></button>
                    <span className="min-w-8 text-center text-sm font-black">{line.quantity}</span>
                    <button type="button" onClick={() => changeQuantity(product.id, 1)} className="flex size-9 items-center justify-center rounded-lg text-koma-accent"><Plus size={15} /></button>
                  </div>
                </div>

                {ingredientObservations.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-koma-muted">Ajustes pelos ingredientes</p>
                    <div className="flex flex-wrap gap-2">
                      {ingredientObservations.map((observation) => {
                        const selected = (line.ingredientObservations || []).includes(observation);
                        return <button key={observation} type="button" onClick={() => toggleIngredientObservation(product.id, observation)} className={`min-h-9 rounded-xl border px-3 text-[11px] font-bold ${selected ? 'border-koma-accent bg-koma-accent/10 text-koma-accent' : 'border-koma-border text-koma-muted'}`}>{selected && <Check size={12} className="mr-1 inline" />}{observation}</button>;
                      })}
                    </div>
                  </div>
                )}

                {categoryObservations.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-koma-muted">Outros atalhos</p>
                    <div className="flex flex-wrap gap-2">
                      {categoryObservations.map((observation) => {
                        const selected = line.observationIds.includes(observation.id);
                        return <button key={observation.id} type="button" onClick={() => toggleObservation(product.id, observation.id)} className={`min-h-9 rounded-xl border px-3 text-[11px] font-bold ${selected ? 'border-koma-accent bg-koma-accent/10 text-koma-accent' : 'border-koma-border text-koma-muted'}`}>{selected && <Check size={12} className="mr-1 inline" />}{observation.texto}</button>;
                      })}
                    </div>
                  </div>
                )}

                <details className="mt-3 rounded-xl border border-koma-border bg-koma-page px-3 py-2">
                  <summary className="cursor-pointer text-[11px] font-bold text-koma-muted">Escrever observação</summary>
                  <textarea value={line.customObservation} onChange={(event) => updateCustomObservation(product.id, event.target.value)} maxLength={180} rows={2} placeholder="Digite somente se necessário" className="mt-2 w-full resize-none rounded-lg border border-koma-border bg-koma-surface p-2 text-xs outline-none focus:border-koma-accent" />
                </details>
              </article>
            );
          })}
        </div>

        {submitError && <p role="alert" className="mt-4 rounded-xl border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">{submitError}</p>}
        {unavailableProducts.length > 0 && <p className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">Um item foi pausado no cardápio enquanto você montava o pedido. Remova-o antes de confirmar.</p>}

        <div className="mt-5 rounded-2xl border border-koma-border bg-koma-surface p-4">
          <div className="flex items-center justify-between text-sm"><span className="text-koma-muted">{totalUnits} {totalUnits === 1 ? 'item' : 'itens'}</span><strong className="text-lg">{money(cartTotal)}</strong></div>
          <button type="button" onClick={() => void submitOrder()} disabled={isSubmitting || totalUnits === 0 || unavailableProducts.length > 0} className="mt-4 flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-koma-accent px-4 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-50">
            {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            {isSubmitting ? 'Enviando…' : isQuickSale ? 'Confirmar e receber' : 'Confirmar pedido'}
          </button>
          <p className="mt-2 text-center text-[10px] leading-4 text-koma-muted">Preço e disponibilidade são validados novamente pelo Kôma ao confirmar.</p>
        </div>
      </section>
    );
  }

  if (view === 'products' && selectedCategory) {
    return (
      <section className="pb-5 pt-6">
        <button type="button" onClick={goBack} className="mb-4 flex items-center gap-2 text-xs font-bold text-koma-muted"><ArrowLeft size={16} /> Categorias</button>
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">{destinationLabel}</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">{selectedCategory.nome}</h1></div>
          <span className="flex items-center gap-1 rounded-full border border-koma-border px-2 py-1 text-[9px] font-bold uppercase text-koma-muted">{isRealtimeConnected ? <Wifi size={11} className="text-koma-accent" /> : <WifiOff size={11} />} catálogo</span>
        </div>
        <p className="mt-2 text-xs text-koma-muted">Toque no item para adicionar. Toques repetidos aumentam a quantidade.</p>

        <nav aria-label="Categorias do cardápio" className="sticky top-0 z-10 -mx-4 mt-4 overflow-x-auto border-y border-koma-border bg-koma-page/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="flex w-max min-w-full gap-2">
            {categories.map(({ category }) => {
              const selected = category.id === selectedCategoryId;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(category.id)}
                  aria-current={selected ? 'page' : undefined}
                  className={`min-h-10 shrink-0 rounded-full border px-4 text-xs font-black ${selected ? 'border-koma-accent bg-koma-accent text-black' : 'border-koma-border bg-koma-surface text-koma-muted'}`}
                >
                  {categoryLabel(category)}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {selectedProducts.map((product) => {
            const quantity = cart[product.id]?.quantity || 0;
            return (
              <article key={product.id} className={`flex min-h-40 flex-col overflow-hidden rounded-2xl border bg-koma-surface ${quantity > 0 ? 'border-koma-accent/70' : 'border-koma-border'}`}>
                <button type="button" onClick={() => addProduct(product)} className="relative flex flex-1 flex-col p-4 text-left active:bg-koma-accent/5" aria-label={`Adicionar ${product.nome}`}>
                  {quantity > 0 && <span className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-full bg-koma-accent text-xs font-black text-black" aria-live="polite">{quantity}</span>}
                  <p className="pr-7 text-sm font-black leading-5">{product.nome}</p>
                  <p className="mt-2 text-sm font-black text-koma-accent">{money(Number(product.preco || 0))}</p>
                  {product.descricao && <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-koma-muted">{product.descricao}</p>}
                </button>
                {quantity > 0 ? (
                  <div className="flex min-h-12 items-center justify-between border-t border-koma-border bg-koma-page/50 px-2 py-1.5">
                    <button type="button" onClick={() => changeQuantity(product.id, -1)} className="flex size-9 items-center justify-center rounded-xl border border-koma-border text-koma-muted active:bg-koma-surface" aria-label={`Diminuir ${product.nome}`}><Minus size={16} /></button>
                    <span className="px-1 text-xs font-black">{quantity}</span>
                    <button type="button" onClick={() => changeQuantity(product.id, 1)} className="flex size-9 items-center justify-center rounded-xl bg-koma-accent text-black active:opacity-80" aria-label={`Aumentar ${product.nome}`}><Plus size={16} /></button>
                  </div>
                ) : (
                  <button type="button" onClick={() => addProduct(product)} className="flex min-h-11 items-center justify-center gap-1.5 border-t border-koma-border text-[11px] font-black text-koma-accent"><Plus size={14} /> Adicionar</button>
                )}
              </article>
            );
          })}
        </div>
        {selectedProducts.length === 0 && <div className="mt-5 rounded-2xl border border-koma-border bg-koma-surface p-5 text-sm text-koma-muted">Nenhum item disponível nesta categoria.</div>}
        {cartBar}
      </section>
    );
  }

  return (
    <section className="pb-5 pt-6">
      <button type="button" onClick={goBack} className="mb-4 flex items-center gap-2 text-xs font-bold text-koma-muted"><ArrowLeft size={16} /> {cancelLabel}</button>
      <div className="flex items-start justify-between gap-3">
        <div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-koma-accent">Novo pedido · {destinationLabel}</p><h1 className="mt-2 text-3xl font-black tracking-[-0.04em]">Escolha a categoria</h1></div>
        <button type="button" onClick={() => void loadCatalog()} className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-koma-border text-koma-muted" aria-label="Atualizar cardápio"><RefreshCw size={16} /></button>
      </div>
      <p className="mt-2 text-xs leading-5 text-koma-muted">Sem teclado: categoria primeiro, depois os itens.</p>

      {catalogError && <p className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">{catalogError}</p>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {categories.map(({ category, products }) => (
          <button key={category.id} type="button" onClick={() => { setSelectedCategoryId(category.id); setView('products'); }} className="min-h-28 rounded-2xl border border-koma-border bg-koma-surface p-4 text-left active:scale-[0.98]">
            <p className="text-sm font-black leading-5">{categoryLabel(category)}</p>
            <p className="mt-2 text-[11px] font-bold uppercase tracking-wide text-koma-accent">{products.length} {products.length === 1 ? 'item' : 'itens'}</p>
            <ChevronRight size={17} className="mt-4 text-koma-muted" />
          </button>
        ))}
      </div>
      {categories.length === 0 && <div className="mt-5 rounded-2xl border border-koma-border bg-koma-surface p-5 text-sm text-koma-muted">Nenhum produto disponível no cardápio.</div>}
      {cartBar}
    </section>
  );
}
