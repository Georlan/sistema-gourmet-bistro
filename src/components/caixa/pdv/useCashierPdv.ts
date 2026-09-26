import React, { useEffect, useMemo, useState } from 'react';
import type { PaymentMethod } from '../../../cardapio/paymentMethods';
import type { CatalogCategory } from '../../../catalog/catalog';
import { projectCashierSalonTables } from '../../../domain/cashierSalonProjection';
import {
  EMPTY_DELIVERY_ADDRESS,
  type DeliveryAddressDraft,
  deliveryAddressDraftToSnapshot,
  formatDeliveryAddressLegacy,
  getDeliveryAddressValidationError,
  parseDeliveryAddressLegacy,
} from '../../../domain/deliveryAddress';
import { smartSearchMatch } from '../../../domain/search';
import { Product } from '../../../types';
import { makeOperationKey, operationalFetch } from '../../../utils/operationalRequest';
import type { CaixaPanelProps, CashierNotice, CashierTab } from '../cashierContracts';
import { formatCompactCurrency } from '../cashierPresentation';

export type PdvModifierSelection = {
  id: string;
  nome: string;
  preco: number;
};

export type PdvCartItem = {
  product: Product;
  quantity: number;
  obs: string;
  client: string;
  modifierIds?: string[];
  modifiers?: PdvModifierSelection[];
};

export const pdvCartItemUnitPrice = (item: PdvCartItem) =>
  Number(item.product.preco || 0)
  + (item.modifiers || []).reduce((sum, modifier) => sum + Number(modifier.preco || 0), 0);

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

const emptyDeliveryAddress = (): DeliveryAddressDraft => ({ ...EMPTY_DELIVERY_ADDRESS });

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

  const [pdvCart, setPdvCart] = useState<PdvCartItem[]>([]);

  const [pdvCustomerName, setPdvCustomerName] = useState('');

  const [pdvCustomerPhone, setPdvCustomerPhone] = useState('');

  const [pdvCustomerId, setPdvCustomerId] = useState<string | null>(null);

  const [pdvCustomerLookup, setPdvCustomerLookup] = useState<'idle' | 'loading' | 'found' | 'new'>('idle');

  const [pdvCustomerCPF, setPdvCustomerCPF] = useState('');

  const [pdvOrderType, setPdvOrderType] = useState<'pickup' | 'delivery' | 'dine_in'>('pickup');

  const [pdvPaymentMethod, setPdvPaymentMethod] = useState<PaymentMethod | null>(null);

  // Legacy text remains only as a projection/backward-compatible payload. The
  // editable source of truth for new delivery orders is the structured draft.
  const [pdvDeliveryAddress, setPdvDeliveryAddress] = useState('');
  const [pdvDeliveryAddressDraft, setPdvDeliveryAddressDraft] = useState<DeliveryAddressDraft>(emptyDeliveryAddress);
  const [pdvDeliveryAddressLegacyHint, setPdvDeliveryAddressLegacyHint] = useState('');

  const handlePdvDeliveryAddressChange = (nextAddress: DeliveryAddressDraft) => {
    setPdvDeliveryAddressDraft(nextAddress);
    setPdvDeliveryAddressLegacyHint('');
    const snapshot = deliveryAddressDraftToSnapshot(nextAddress);
    setPdvDeliveryAddress(snapshot ? formatDeliveryAddressLegacy(snapshot) : '');
  };

  const [pdvDeliveryTaxa, setPdvDeliveryTaxa] = useState<number>(0);

  const [pdvTargetMesaId, setPdvTargetMesaId] = useState<number>(0);

  const selectedPdvTableOption = pdvTableOptions.find((option) => option.table.id === pdvTargetMesaId);

  const pdvCartItemCount = pdvCart.reduce((sum, item) => sum + item.quantity, 0);

  useEffect(() => {
    if (pdvOrderType === 'dine_in') {
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
        if (pdvOrderType === 'delivery' && customer.endereco) {
          const storedAddress = String(customer.endereco).trim();
          const parsedAddress = parseDeliveryAddressLegacy(storedAddress);
          setPdvDeliveryAddress(storedAddress);
          if (parsedAddress) {
            setPdvDeliveryAddressDraft(parsedAddress);
            setPdvDeliveryAddressLegacyHint('');
          } else {
            setPdvDeliveryAddressDraft(emptyDeliveryAddress());
            setPdvDeliveryAddressLegacyHint(storedAddress);
          }
        }
        setPdvCustomerLookup('found');
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setPdvCustomerLookup('idle');
      }
    }, 180);

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
        setPdvOrderType('pickup');
        setTimeout(() => {
          const phoneInput = document.getElementById('pdv-customer-phone-input');
          if (phoneInput) phoneInput.focus();
        }, 50);
      } else if (e.key === 'F3') {
        e.preventDefault();
        setPdvOrderType('dine_in');
        setTimeout(() => {
          const mesaSelect = document.getElementById('pdv-target-table');
          if (mesaSelect) mesaSelect.focus();
        }, 50);
      } else if (e.key === 'F8') {
        e.preventDefault();
        setPdvOrderType('delivery');
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
      const idx = prev.findIndex((item) =>
        item.product.id === product.id
        && item.client === 'Balcão'
        && !item.obs
        && (item.modifierIds || []).length === 0,
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + 1 };
        return copy;
      }
      return [...prev, { product, quantity: 1, obs: '', client: 'Balcão', modifierIds: [], modifiers: [] }];
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
    if (pdvOrderType !== 'dine_in' && !pdvPaymentMethod) {
      showToast('Escolha a forma de pagamento da entrega ou retirada.', 'info');
      return;
    }
    const normalizedCustomerPhone = pdvCustomerPhone.replace(/\D/g, '');
    if (pdvOrderType !== 'dine_in' && ![10, 11].includes(normalizedCustomerPhone.length)) {
      showToast('Informe um celular válido com DDD.', 'info');
      return;
    }
    if (pdvOrderType !== 'dine_in' && pdvCustomerName.trim().length < 2) {
      showToast('Informe o nome do cliente.', 'info');
      return;
    }

    const deliverySnapshot = pdvOrderType === 'delivery'
      ? deliveryAddressDraftToSnapshot(pdvDeliveryAddressDraft)
      : null;
    if (pdvOrderType === 'delivery' && !deliverySnapshot) {
      showToast(
        getDeliveryAddressValidationError(pdvDeliveryAddressDraft) || 'Informe o endereço completo de entrega.',
        'info',
      );
      return;
    }

    isPdvSubmittingRef.current = true;
    setIsLoading(true);

    const cartItems = [...pdvCart];
    const customerName = pdvCustomerName;
    const mesaId = pdvTargetMesaId;
    const orderType = pdvOrderType;
    const paymentMethod = pdvPaymentMethod;
    const customerPhone = pdvCustomerPhone;
    const customerId = pdvCustomerId;
    const deliveryAddressDraft = { ...pdvDeliveryAddressDraft };
    const deliveryAddressLegacyHint = pdvDeliveryAddressLegacyHint;
    const deliveryAddress = deliverySnapshot ? formatDeliveryAddressLegacy(deliverySnapshot) : '';
    const deliveryTaxa = pdvDeliveryTaxa;

    setActiveTab('operacao');
    setActiveSubTab('pedidos');
    showToast('Enviando pedido para a cozinha...', 'info');

    let optimisticTempId: string | null = null;
    const clearOptimisticOrder = () => {
      if (!optimisticTempId) return;
      window.dispatchEvent(new CustomEvent('koma_optimistic_order_remove', {
        detail: { orderId: optimisticTempId },
      }));
    };

    if (onOptimisticAddOrder) {
      const now = Date.now();
      const tempId = `temp-${now}`;
      optimisticTempId = tempId;
      const tempItems = cartItems.flatMap((item, idx) =>
        Array.from({ length: item.quantity }, (_, qtyIdx) => ({
          id: `temp-item-${idx}-${qtyIdx}-${now}`,
          produtoId: item.product.id,
          nome: item.product.nome,
          preco: pdvCartItemUnitPrice(item),
          observacao: item.obs || '',
          clienteNome: customerName || 'Consumo Geral',
          status: 'preparando' as const,
          lancamentoId: `temp-l-${now}`,
        })),
      );

      const optimisticOrder = {
        id: tempId,
        mesaId: orderType === 'delivery' ? 0 : mesaId || 0,
        garcomId: 'c-01',
        garcomNome: activeWaiterNome || 'Caixa 1',
        timestamp: now,
        created_at: new Date(now).toISOString(),
        tipo: orderType === 'dine_in' ? 'Consumo no Local' as const : orderType === 'delivery' ? 'Entrega' as const : 'Retirada' as const,
        valorPago: 0,
        identificador: customerName || undefined,
        clienteId: customerId,
        clientePhone: orderType === 'dine_in' ? null : customerPhone,
        statusComanda: null,
        deliveryStatus: orderType === 'dine_in'
          ? (mesaId > 0 ? null : 'producao' as const)
          : 'producao' as const,
        deliveryAddress: orderType === 'delivery' ? deliveryAddress : null,
        deliveryTax: orderType === 'delivery' ? Number(deliveryTaxa || 0) : 0,
        paymentMethod: orderType === 'dine_in' ? null : paymentMethod,
        origemOperacional: 'caixa' as const,
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
    setPdvPaymentMethod(null);
    setPdvDeliveryAddress('');
    setPdvDeliveryAddressDraft(emptyDeliveryAddress());
    setPdvDeliveryAddressLegacyHint('');
    setPdvDeliveryTaxa(0);

    try {
      const itemsList = cartItems.flatMap((item) =>
        Array.from({ length: item.quantity }, () => ({
          produto_id: item.product.id,
          observacao: item.obs || '',
          cliente_nome: customerName || 'Consumo Geral',
          modificador_ids: item.modifierIds || [],
        })),
      );
      const onboardingTest = (() => {
        try {
          return sessionStorage.getItem("koma_onboarding_test_order") === "1";
        } catch {
          return false;
        }
      })();
      const salePayload = {
        cliente_id: orderType === 'dine_in' ? undefined : customerId || undefined,
        mesa_id: orderType === 'delivery' ? null : mesaId || null,
        tipo: orderType === 'dine_in' ? 'Consumo no Local' : orderType === 'delivery' ? 'Entrega' : 'Retirada',
        identificador: customerName || undefined,
        delivery_status: orderType === 'dine_in' ? undefined : 'producao',
        delivery_telefone: orderType === 'dine_in' ? undefined : customerPhone,
        delivery_endereco: orderType === 'delivery' ? deliveryAddress : undefined,
        address_snapshot: orderType === 'delivery' ? deliverySnapshot || undefined : undefined,
        delivery_taxa: orderType === 'delivery' ? Number(deliveryTaxa || 0) : 0.0,
        delivery_forma_pagamento: orderType === 'dine_in' ? undefined : paymentMethod || undefined,
        onboarding_test: onboardingTest,
        itens: itemsList,
      };
      const saleFingerprint = JSON.stringify(salePayload);
      if (pdvPendingOperationRef.current?.fingerprint !== saleFingerprint) {
        pdvPendingOperationRef.current = {
          fingerprint: saleFingerprint,
          key: makeOperationKey('cashier-sale'),
        };
      }

      const res = await operationalFetch(`${apiBaseUrl}/cardapio/modificadores/venda-direta`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...salePayload,
          idempotency_key: pdvPendingOperationRef.current.key,
        }),
      });

      if (res.ok) {
        const confirmedComanda = await res.json().catch(() => null);
        pdvPendingOperationRef.current = null;
        if (onboardingTest) {
          try {
            sessionStorage.removeItem("koma_onboarding_test_order");
          } catch {
            // Restricted browser storage must not invalidate a confirmed sale.
          }
        }

        if (optimisticTempId && confirmedComanda?.id) {
          window.dispatchEvent(new CustomEvent('koma_optimistic_order_reconcile', {
            detail: { tempId: optimisticTempId, comanda: confirmedComanda },
          }));
        }

        showToast('Pedido confirmado e enviado à cozinha.', 'success');
        void Promise.allSettled([
          Promise.resolve(onRefreshOrders()),
          fetchDeliveryOrders(),
        ]).then(() => {
          if (!confirmedComanda?.id) clearOptimisticOrder();
          window.dispatchEvent(new Event('koma_orders_updated'));
        });
      } else {
        const err = await res.json();
        clearOptimisticOrder();
        showToast(`Erro ao registrar venda: ${err.detail || 'Falha no servidor'}`, 'error');
        setPdvCart((prev) => (prev.length > 0 ? prev : cartItems));
        setPdvCustomerName(customerName);
        setPdvCustomerPhone(customerPhone);
        setPdvCustomerId(customerId);
        setPdvPaymentMethod(paymentMethod);
        setPdvDeliveryAddress(deliveryAddress);
        setPdvDeliveryAddressDraft(deliveryAddressDraft);
        setPdvDeliveryAddressLegacyHint(deliveryAddressLegacyHint);
        setPdvDeliveryTaxa(deliveryTaxa);
      }
    } catch (err) {
      console.error(err);
      clearOptimisticOrder();
      showToast('A rede falhou. O carrinho foi restaurado para você tentar novamente.', 'error');
      setPdvCart((prev) => (prev.length > 0 ? prev : cartItems));
      setPdvCustomerName(customerName);
      setPdvCustomerPhone(customerPhone);
      setPdvCustomerId(customerId);
      setPdvPaymentMethod(paymentMethod);
      setPdvDeliveryAddress(deliveryAddress);
      setPdvDeliveryAddressDraft(deliveryAddressDraft);
      setPdvDeliveryAddressLegacyHint(deliveryAddressLegacyHint);
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
    const cartTotal = pdvCart.reduce((total, item) => total + pdvCartItemUnitPrice(item) * item.quantity, 0);
    const destination =
      pdvOrderType === 'delivery'
        ? 'Delivery'
        : pdvOrderType === 'pickup'
          ? pdvTargetMesaId > 0
            ? `Retirada · Mesa ${pdvTargetMesaId}`
            : 'Retirada'
          : pdvTargetMesaId > 0
            ? `Consumo local · Mesa ${pdvTargetMesaId}`
            : 'Consumo no local';
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
      setPdvOrderType('pickup');
      setPdvPaymentMethod(null);
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
    pdvPaymentMethod,
    setPdvPaymentMethod,
    pdvDeliveryAddress,
    pdvDeliveryAddressDraft,
    pdvDeliveryAddressLegacyHint,
    handlePdvDeliveryAddressChange,
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