import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogCategory } from '../../../catalog/catalog';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import { smartSearchMatch } from '../../../domain/search';
import { Product } from '../../../types';
import { makeOperationKey, operationalFetch } from '../../../utils/operationalRequest';
import type { CaixaPanelProps, CashierNotice, CashierTab } from '../cashierContracts';
import { formatCompactCurrency } from '../cashierPresentation';

type Props = {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  activeTab: string;
  activeSubTab: string;
  setActiveTab: (tab: CashierTab) => void;
  setActiveSubTab: (tab: string) => void;
  showToast: CashierNotice;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  onRefreshOrders: CaixaPanelProps['onRefreshOrders'];
  onOptimisticAddOrder: CaixaPanelProps['onOptimisticAddOrder'];
  activeWaiterNome: string;
  fetchDeliveryOrders: () => Promise<void>;
  apiCategorias: CatalogCategory[];
  dynamicMenu: Product[];
  pdvTableOptions: Array<ReturnType<typeof projectCashierSalonTables>[number] & { label: string }>;
};

export function useCashierPdv({
  apiBaseUrl,
  authHeaders,
  activeTab,
  activeSubTab,
  setActiveTab,
  setActiveSubTab,
  showToast,
  setIsLoading,
  onRefreshOrders,
  onOptimisticAddOrder,
  activeWaiterNome,
  fetchDeliveryOrders,
  apiCategorias,
  dynamicMenu,
  pdvTableOptions,
}: Props) {
  const [balcaoMobileView, setBalcaoMobileView] = useState<'produtos' | 'carrinho'>('produtos');

  const [pdvProductDetailId, setPdvProductDetailId] = useState<string | null>(null);

  const pdvOccupiedTableCount = pdvTableOptions.filter((option) => option.isOccupied).length;

  const [pdvSearch, setPdvSearch] = useState('');

  const [pdvSelectedCategory, setPdvSelectedCategory] = useState<string>('todos');

  const [pdvCart, setPdvCart] = useState<{ product: Product; quantity: number; obs: string; client: string }[]>([]);

  const [pdvCustomerName, setPdvCustomerName] = useState('');

  const [pdvCustomerPhone, setPdvCustomerPhone] = useState('');

  const [pdvCustomerId, setPdvCustomerId] = useState<string | null>(null);

  const [pdvCustomerLookup, setPdvCustomerLookup] = useState<'idle' | 'loading' | 'found' | 'new'>('idle');

  const [pdvCustomerCPF, setPdvCustomerCPF] = useState('');

  const [pdvOrderType, setPdvOrderType] = useState<'retirada' | 'entrega' | 'mesa'>('retirada');

  const [pdvDeliveryAddress, setPdvDeliveryAddress] = useState('');

  const [pdvDeliveryTaxa, setPdvDeliveryTaxa] = useState<number>(0);

  const [pdvTargetMesaId, setPdvTargetMesaId] = useState<number>(0);

  const selectedPdvTableOption = pdvTableOptions.find((option) => option.table.id === pdvTargetMesaId);

  const pdvCartItemCount = pdvCart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    if (pdvOrderType === 'mesa') {
      setPdvCustomerId(null);
      setPdvCustomerLookup('idle');
      return;
    }
    const normalizedPhone = pdvCustomerPhone.replace(/\D/g, '');
    if (normalizedPhone.length < 10 || normalizedPhone.length > 11) {
      setPdvCustomerId(null);
      setPdvCustomerLookup('idle');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setPdvCustomerLookup('loading');
      try {
        const response = await fetch(
          `${apiBaseUrl}/fidelidade/clientes/lookup?telefone=${encodeURIComponent(normalizedPhone)}`,
          { headers: authHeaders, signal: controller.signal },
        );
        if (response.status === 404) {
          setPdvCustomerId(null);
          setPdvCustomerLookup('new');
          return;
        }
        if (!response.ok) {
          setPdvCustomerLookup('idle');
          return;
        }
        const customer = await response.json();
        setPdvCustomerId(String(customer.id));
        setPdvCustomerName(String(customer.cliente || customer.nome || ''));
        if (pdvOrderType === 'entrega' && customer.endereco) {
          setPdvDeliveryAddress(String(customer.endereco));
        }
        setPdvCustomerLookup('found');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setPdvCustomerLookup('idle');
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [pdvCustomerPhone, pdvOrderType, apiBaseUrl]);

  useEffect(() => {
    if (activeSubTab !== 'balcao') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

      if (e.key === 'F1') {
        e.preventDefault();
        const searchInput = document.getElementById('pdv-search-input');
        if (searchInput) {
          searchInput.focus();
          (searchInput as HTMLInputElement).select();
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        setPdvOrderType('retirada');
        setTimeout(() => {
          const phoneInput = document.getElementById('pdv-customer-phone-input');
          if (phoneInput) phoneInput.focus();
        }, 50);
      } else if (e.key === 'F3') {
        e.preventDefault();
        setPdvOrderType('mesa');
        setTimeout(() => {
          const mesaSelect = document.getElementById('pdv-mesa-select');
          if (mesaSelect) mesaSelect.focus();
        }, 50);
      } else if (e.key === 'F8') {
        e.preventDefault();
        setPdvOrderType('entrega');
        setTimeout(() => {
          const phoneInput = document.getElementById('pdv-customer-phone-input');
          if (phoneInput) phoneInput.focus();
        }, 50);
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (pdvCart.length > 0) {
          const submitBtn = document.getElementById('pdv-submit-btn');
          if (submitBtn) submitBtn.click();
        }
      } else if (e.key === 'Escape') {
        if (isInput) {
          target.blur();
        }
        setPdvSearch('');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSubTab, pdvCart]);

  const handlePdvAddToCart = (product: Product) => {
    setPdvCart((prev) => {
      const idx = prev.findIndex((item) => item.product.id === product.id && item.client === 'Balcão');
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, { product, quantity: 1, obs: '', client: 'Balcão' }];
    });
  };

  const handlePdvUpdateCartQty = (idx: number, delta: number) => {
    setPdvCart((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], quantity: Math.max(1, copy[idx].quantity + delta) };
      return copy;
    });
  };

  const handlePdvRemoveCartItem = (idx: number) => {
    setPdvCart((prev) => prev.filter((_, i) => i !== idx));
  };

  const isPdvSubmittingRef = React.useRef(false);

  const pdvPendingOperationRef = React.useRef<{ fingerprint: string; key: string } | null>(null);

  const handlePdvSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isPdvSubmittingRef.current) return; // Sync ref guard (faster than isLoading state check)
    if (pdvCart.length === 0) {
      showToast('Seu carrinho de vendas está vazio.', 'info');
      return;
    }
    if (pdvOrderType === 'mesa' && (!pdvTargetMesaId || pdvTargetMesaId === 0)) {
      showToast('Selecione a mesa de destino antes de lançar o pedido.', 'info');
      return;
    }
    const normalizedCustomerPhone = pdvCustomerPhone.replace(/\D/g, '');
    if (pdvOrderType !== 'mesa' && ![10, 11].includes(normalizedCustomerPhone.length)) {
      showToast('Informe um celular válido com DDD.', 'info');
      return;
    }
    if (pdvOrderType !== 'mesa' && pdvCustomerName.trim().length < 2) {
      showToast('Informe o nome do cliente.', 'info');
      return;
    }
    isPdvSubmittingRef.current = true;
    setIsLoading(true);

    const cartItems = [...pdvCart];
    const customerName = pdvCustomerName;
    const mesaId = pdvTargetMesaId;
    const orderType = pdvOrderType;
    const customerPhone = pdvCustomerPhone;
    const customerId = pdvCustomerId;
    const deliveryAddress = pdvDeliveryAddress;
    const deliveryTaxa = pdvDeliveryTaxa;

    setActiveTab('operacao');
    setActiveSubTab('pedidos');
    showToast('Enviando pedido para a cozinha...', 'info');

    if (onOptimisticAddOrder) {
      const tempId = `temp-${Date.now()}`;
      const tempItems = cartItems.flatMap((item, idx) =>
        Array.from({ length: item.quantity }, (_, qtyIdx) => ({
          id: `temp-item-${idx}-${qtyIdx}-${Date.now()}`,
          produtoId: item.product.id,
          nome: item.product.nome,
          preco: item.product.preco,
          observacao: item.obs || '',
          clienteNome: customerName || 'Consumo Geral',
          status: 'preparando',
          lancamentoId: `temp-l-${Date.now()}`,
        })),
      );

      const optimisticOrder = {
        id: tempId,
        mesaId: orderType === 'mesa' ? mesaId || 0 : 0,
        garcomId: 'c-01',
        garcomNome: activeWaiterNome || 'Caixa 1',
        timestamp: new Date(),
        tipo: orderType === 'mesa' ? 'Consumo no Local' : orderType === 'entrega' ? 'Entrega' : 'Retirada',
        valorPago: 0,
        identificador: customerName || null,
        statusComanda: null,
        deliveryStatus: orderType === 'mesa' ? null : 'producao',
        mesaOrigemId: null,
        mesaTransferidaDe: null,
        itens: tempItems,
      };
      onOptimisticAddOrder(optimisticOrder);
    }

    setPdvCart([]);
    setPdvCustomerName('');
    setPdvCustomerPhone('');
    setPdvCustomerId(null);
    setPdvCustomerLookup('idle');
    setPdvCustomerCPF('');
    setPdvDeliveryAddress('');
    setPdvDeliveryTaxa(0);

    try {
      const itemsList = cartItems.flatMap((item) =>
        Array.from({ length: item.quantity }, () => ({
          produto_id: item.product.id,
          observacao: item.obs || '',
          cliente_nome: customerName || 'Consumo Geral',
        })),
      );
      const salePayload = {
        cliente_id: orderType === 'mesa' ? undefined : customerId || undefined,
        mesa_id: orderType === 'mesa' ? mesaId : null,
        tipo: orderType === 'mesa' ? 'Consumo no Local' : orderType === 'entrega' ? 'Entrega' : 'Retirada',
        identificador: customerName || undefined,
        delivery_status: orderType === 'mesa' ? undefined : 'producao',
        delivery_telefone: orderType === 'mesa' ? undefined : customerPhone,
        delivery_endereco: orderType === 'entrega' ? deliveryAddress : undefined,
        delivery_taxa: orderType === 'entrega' ? Number(deliveryTaxa || 0) : 0.0,
        itens: itemsList,
      };
      const saleFingerprint = JSON.stringify(salePayload);
      if (pdvPendingOperationRef.current?.fingerprint !== saleFingerprint) {
        pdvPendingOperationRef.current = {
          fingerprint: saleFingerprint,
          key: makeOperationKey('cashier-sale'),
        };
      }

      const res = await operationalFetch(`${apiBaseUrl}/comandas/venda-direta`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...salePayload,
          idempotency_key: pdvPendingOperationRef.current.key,
        }),
      });

      if (res.ok) {
        pdvPendingOperationRef.current = null;
        showToast('Pedido confirmado e enviado à cozinha.', 'success');
        onRefreshOrders();
        fetchDeliveryOrders();
        window.dispatchEvent(new Event('koma_orders_updated'));
      } else {
        const err = await res.json();
        showToast(`Erro ao registrar venda: ${err.detail || 'Falha no servidor'}`, 'error');
        setPdvCart((prev) => (prev.length > 0 ? prev : cartItems));
        setPdvCustomerName(customerName);
        setPdvCustomerPhone(customerPhone);
        setPdvCustomerId(customerId);
        setPdvDeliveryAddress(deliveryAddress);
        setPdvDeliveryTaxa(deliveryTaxa);
      }
    } catch (err) {
      console.error(err);
      showToast('A rede falhou. O carrinho foi restaurado para você tentar novamente.', 'error');
      setPdvCart((prev) => (prev.length > 0 ? prev : cartItems));
      setPdvCustomerName(customerName);
      setPdvCustomerPhone(customerPhone);
      setPdvCustomerId(customerId);
      setPdvDeliveryAddress(deliveryAddress);
      setPdvDeliveryTaxa(deliveryTaxa);
    } finally {
      isPdvSubmittingRef.current = false;
      setIsLoading(false);
    }
  };

  const sellableProducts = useMemo(() => dynamicMenu.filter((product) => product.ativo !== false), [dynamicMenu]);

  const pdvCategories = useMemo(() => {
    const activeCategoryIds = new Set(sellableProducts.map((product) => product.categoria_id).filter(Boolean));
    return apiCategorias.filter((category) => activeCategoryIds.has(category.id));
  }, [apiCategorias, sellableProducts]);

  const pdvMenuInsights = useMemo(() => {
    const itemCount = pdvCart.reduce((total, item) => total + item.quantity, 0);
    const cartTotal = pdvCart.reduce((total, item) => total + item.product.preco * item.quantity, 0);
    const destination =
      pdvOrderType === 'mesa'
        ? pdvTargetMesaId > 0
          ? `Mesa ${pdvTargetMesaId}`
          : 'Escolher mesa'
        : pdvOrderType === 'entrega'
          ? 'Delivery'
          : 'Retirada';
    return {
      destination,
      itemCount,
      total: formatCompactCurrency(cartTotal),
      pausedCount: Math.max(0, dynamicMenu.length - sellableProducts.length),
    };
  }, [dynamicMenu.length, pdvCart, pdvOrderType, pdvTargetMesaId, sellableProducts.length]);

  const filteredProducts = useMemo(
    () =>
      sellableProducts.filter((product) => {
        const category = apiCategorias.find(
          (item) =>
            item.id === product.categoria_id || item.id === product.categoria || item.nome === product.categoria,
        );
        const categoryName = category?.nome || product.categoria || '';
        const matchesCategory =
          pdvSelectedCategory === 'todos' ||
          categoryName === pdvSelectedCategory ||
          product.categoria_id === pdvSelectedCategory ||
          product.categoria === pdvSelectedCategory;
        const matchesSearch = !pdvSearch || smartSearchMatch(`${product.nome} ${product.descricao || ''}`, pdvSearch);
        return matchesCategory && matchesSearch;
      }),
    [apiCategorias, pdvSearch, pdvSelectedCategory, sellableProducts],
  );

  useEffect(() => {
    if (pdvSelectedCategory !== 'todos' && !pdvCategories.some((category) => category.nome === pdvSelectedCategory)) {
      setPdvSelectedCategory('todos');
    }
  }, [pdvCategories, pdvSelectedCategory]);

  // Returning to an existing draft/retry must not silently change its destination.
  const openCounter = () => {
    if (pdvCart.length === 0 && !isPdvSubmittingRef.current && !pdvPendingOperationRef.current) {
      setPdvOrderType('retirada');
      setPdvTargetMesaId(0);
    }
    setBalcaoMobileView('produtos');
    setPdvProductDetailId(null);
  };

  // Navigation Tree v2 emits a semantic action instead of reproducing PDV reset
  // rules. The PDV remains the owner of how a fresh counter sale is prepared.
  useEffect(() => {
    const handleNavigationOpenCounter = () => openCounter();
    window.addEventListener('koma-navigation-open-counter', handleNavigationOpenCounter);
    return () => window.removeEventListener('koma-navigation-open-counter', handleNavigationOpenCounter);
  }, [pdvCart.length]);

  return {
    openCounter,
    balcaoMobileView,
    setBalcaoMobileView,
    pdvProductDetailId,
    setPdvProductDetailId,
    pdvOccupiedTableCount,
    pdvSearch,
    setPdvSearch,
    pdvSelectedCategory,
    setPdvSelectedCategory,
    pdvCart,
    setPdvCart,
    pdvCustomerName,
    setPdvCustomerName,
    pdvCustomerPhone,
    setPdvCustomerPhone,
    setPdvCustomerId,
    pdvCustomerLookup,
    pdvOrderType,
    setPdvOrderType,
    pdvDeliveryAddress,
    setPdvDeliveryAddress,
    pdvTargetMesaId,
    setPdvTargetMesaId,
    selectedPdvTableOption,
    pdvCartItemCount,
    handlePdvAddToCart,
    handlePdvUpdateCartQty,
    handlePdvRemoveCartItem,
    handlePdvSubmitOrder,
    sellableProducts,
    pdvCategories,
    pdvMenuInsights,
    filteredProducts,
  };
}
