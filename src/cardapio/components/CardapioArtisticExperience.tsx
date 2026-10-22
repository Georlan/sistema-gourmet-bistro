/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Crown,
  Gift,
  House,
  Minus,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import {
  BrandConfig,
  CatalogPromotion,
  LOCAL_LOGO_PLACEHOLDER,
  LOCAL_PRODUCT_PLACEHOLDER,
  Product,
} from '../CardapioTypes';
import { CustomerProfile } from '../customerSession';
import { OrderStateContract, StoredOrder, orderFulfillmentLabel } from '../orderTracking';
import { buildKomaAttributionUrl } from '../komaAttribution';
import { getPairingRecommendations } from '../pairingRecommendations';
import type { CartItem } from './CardapioCartDrawer';
import CatalogProductImage from './CatalogProductImage';
import {
  KomaBagIcon,
  KomaInfoIcon,
  KomaOrderChatIcon,
  KomaSearchIcon,
  KomaShareIcon,
  KomaSocialCameraIcon,
  KomaUserIcon,
} from './KomaPublicIcons';
import '../cardapioArtisticExperience.css';

export interface CardapioArtisticExperienceProps {
  activeBrand: BrandConfig;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  onSelectProduct: (product: Product) => void;
  onFastAdd: (product: Product, event?: React.MouseEvent) => void;
  onFastRemove: (product: Product, event?: React.MouseEvent) => void;
  getProductCartQuantity: (productId: string) => number;
  onCartToggle: () => void;
  cartCount: number;
  cartTotal?: number;
  cart?: CartItem[];
  onStoreInfoClick: () => void;
  onOrdersClick?: () => void;
  activeOrdersCount?: number;
  hasOpenOverlay?: boolean;
  // Paridade comercial KÔMA
  onPromotionSelect?: (promotion: CatalogPromotion) => void;
  user?: CustomerProfile | null;
  onAuthClick?: () => void;
  onBenefitsClick?: () => void;
  activeOrder?: StoredOrder | null;
  activeState?: OrderStateContract | null;
  storedOrders?: StoredOrder[];
  storedOrdersCount?: number;
  onSelectOrderId?: (id: string) => void;
  onPayPixClick?: (order: StoredOrder) => void;
  onRefreshOrders?: () => void;
  isRefreshingOrders?: boolean;
  onClearTrackedOrder?: (orderId: string) => void;
  orderingMessage?: string;
}

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function formatPrice(value: number): string {
  return currencyFormatter.format(value);
}

/**
 * Fallback artístico com cúpula de serviço (Cloche) para itens sem fotografia.
 */
function ArtisticClocheIllustration() {
  return (
    <div className="koma-art-cloche" aria-hidden="true">
      <svg viewBox="0 0 80 80" className="koma-art-cloche__svg" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="40" cy="22" r="3.5" className="koma-art-cloche__handle" />
        <path
          d="M18 52C18 36.5 27.5 25.5 40 25.5C52.5 25.5 62 36.5 62 52H18Z"
          className="koma-art-cloche__dome"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1="14" y1="56" x2="66" y2="56" className="koma-art-cloche__tray" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M36 17C36 14 38 12 40 10" className="koma-art-cloche__steam" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span className="koma-art-cloche__caption">Item da casa</span>
    </div>
  );
}

export function CardapioArtisticExperience({
  activeBrand,
  searchQuery,
  setSearchQuery,
  selectedCategory,
  onSelectCategory,
  onSelectProduct,
  onFastAdd,
  onFastRemove,
  getProductCartQuantity,
  onCartToggle,
  cartCount,
  cartTotal = 0,
  cart = [],
  onStoreInfoClick,
  onOrdersClick,
  activeOrdersCount = 0,
  hasOpenOverlay = false,
  onPromotionSelect,
  user,
  onAuthClick,
  onBenefitsClick,
  activeOrder,
  activeState,
  storedOrders = [],
  storedOrdersCount = 0,
  onSelectOrderId,
  onPayPixClick,
  onRefreshOrders,
  isRefreshingOrders = false,
  onClearTrackedOrder,
  orderingMessage = '',
}: CardapioArtisticExperienceProps) {
  const [shareToastVisible, setShareToastVisible] = useState(false);

  // Compartilhar cardápio com feedback ao usuário
  const handleShare = async () => {
    const shareData = {
      title: activeBrand.name,
      text: activeBrand.slogan ? `${activeBrand.name} — ${activeBrand.slogan}` : activeBrand.name,
      url: typeof window !== 'undefined' ? window.location.href : '',
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // Usuário cancelou ou navegador recusou compartilhamento nativo; tenta fallback
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setShareToastVisible(true);
        setTimeout(() => setShareToastVisible(false), 2500);
      } catch {
        // fallback
      }
    }
  };

  // Reatividade para ranking dos mais pedidos
  const [popularIds, setPopularIds] = useState<string[]>(() => activeBrand.popularProductIds || []);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<string[]>;
      if (Array.isArray(custom.detail)) {
        setPopularIds(custom.detail);
      }
    };
    window.addEventListener('koma:popular-products-loaded', handler);
    return () => window.removeEventListener('koma:popular-products-loaded', handler);
  }, []);

  // Promoções vigentes da marca (combos por composição)
  const offers = useMemo(() => {
    const campaigns = activeBrand.promotions || [];
    return campaigns.filter(
      (offer) => !offer.fim_em || Date.parse(offer.fim_em) > Date.now()
    );
  }, [activeBrand.promotions]);

  // Canais de contato verificados
  const whatsappUrl = useMemo(() => {
    if (!activeBrand.phone) return null;
    return `https://wa.me/${String(activeBrand.phone).replace(/\D/g, '')}`;
  }, [activeBrand.phone]);

  const instagramSocial = useMemo(() => {
    return (activeBrand.socials || []).find(
      (s) => s.active && s.platform.toLowerCase() === 'instagram'
    );
  }, [activeBrand.socials]);

  // Identificação do produto Hero (seleciona o #1 em vendas ou o primeiro disponível)
  const heroProduct = useMemo<Product | null>(() => {
    if (!activeBrand.products || activeBrand.products.length === 0) return null;
    const effectivePopularIds = popularIds.length > 0 ? popularIds : (activeBrand.popularProductIds || []);
    if (effectivePopularIds.length > 0) {
      const topId = String(effectivePopularIds[0]);
      const found = activeBrand.products.find((p) => String(p.id) === topId && p.isAvailable !== false);
      if (found) return found;
    }
    return activeBrand.products.find((p) => p.isAvailable !== false) || activeBrand.products[0] || null;
  }, [activeBrand.products, popularIds, activeBrand.popularProductIds]);

  // Produtos de harmonização / recomendação complementar contextual
  const pairingProducts = useMemo<Product[]>(() => {
    const cartProductIds = (cart || []).map((item) => item.product.id);
    return getPairingRecommendations({
      catalog: activeBrand.products || [],
      cartProductIds,
      focusedProductId: heroProduct?.id,
      limit: 4,
    });
  }, [activeBrand.products, cart, heroProduct?.id]);

  // Filtragem de catálogo com busca
  const filteredProducts = useMemo<Product[]>(() => {
    if (!searchQuery.trim()) return activeBrand.products;
    const q = searchQuery.toLowerCase().trim();
    return activeBrand.products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.description && p.description.toLowerCase().includes(q))
    );
  }, [activeBrand.products, searchQuery]);

  // Categorias ativas
  const visibleCategories = useMemo<string[]>(() => {
    const catsWithProducts = new Set<string>();
    filteredProducts.forEach((p) => {
      if (p.category) catsWithProducts.add(p.category);
    });
    return (activeBrand.categories || []).filter((c) => catsWithProducts.has(c));
  }, [activeBrand.categories, filteredProducts]);

  const heroCartQty = heroProduct ? getProductCartQuantity(heroProduct.id) : 0;
  const isVerifiedTopRanked = Boolean(
    popularIds.length > 0 &&
    heroProduct &&
    String(popularIds[0]) === String(heroProduct.id)
  );

  return (
    <div className="koma-art-canvas" id="koma-artistic-canvas">
      {/* ========================================================
          ZONA 1: O DOSSEL GASTRONÔMICO ATMOSFÉRICO (MACRO-ZONA 1)
          ======================================================== */}
      <header className="koma-art-canopy" id="koma-artistic-canopy">
        <div className="koma-art-canopy__shell">
          {/* Topline: Identidade da Marca & Ações Utilitárias */}
          <div className="koma-art-canopy__topline">
            <button
              type="button"
              onClick={onStoreInfoClick}
              className="koma-art-brand-badge"
              title="Informações do restaurante"
              aria-label="Informações do restaurante"
              id="header-brand-info-trigger"
            >
              {activeBrand.logo ? (
                <img
                  src={activeBrand.logo}
                  alt={activeBrand.name}
                  className="koma-art-brand-logo"
                  crossOrigin="anonymous"
                  referrerPolicy="no-referrer"
                  onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = LOCAL_LOGO_PLACEHOLDER;
                  }}
                />
              ) : (
                <div className="koma-art-brand-logo--fallback">K</div>
              )}
              <div className="koma-art-brand-text">
                <span className="koma-art-brand-name">{activeBrand.name}</span>
                <span className="koma-art-brand-slogan">{activeBrand.slogan || 'Cardápio digital'}</span>
              </div>
            </button>

            <div className="koma-art-canopy__actions">
              {/* Contato WhatsApp (visível em telas médias e acima; mobile acessa em Informações da Loja) */}
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="koma-art-action-pill koma-art-action-pill--whatsapp hidden md:inline-flex"
                  title="Falar no WhatsApp"
                  aria-label="Falar no WhatsApp"
                  id="btn-whatsapp-header"
                >
                  <Phone className="w-3.5 h-3.5" />
                </a>
              )}

              {/* Instagram (visível em telas médias e acima) */}
              {instagramSocial && (
                <a
                  href={instagramSocial.url}
                  target="_blank"
                  rel="noreferrer"
                  className="koma-art-action-pill koma-art-action-pill--instagram hidden md:inline-flex"
                  title="Instagram do restaurante"
                  aria-label="Instagram do restaurante"
                  id="btn-instagram-header"
                >
                  <KomaSocialCameraIcon size={14} />
                </a>
              )}

              {/* Compartilhar (desktop / tablet) */}
              <button
                type="button"
                onClick={handleShare}
                className="koma-art-action-pill koma-art-action-pill--share hidden md:inline-flex"
                title="Compartilhar cardápio"
                aria-label="Compartilhar cardápio"
                id="btn-share-header"
              >
                <KomaShareIcon size={15} />
              </button>

              {/* Informações da loja */}
              <button
                type="button"
                onClick={onStoreInfoClick}
                className="koma-art-action-pill koma-art-action-pill--store-info hidden sm:inline-flex"
                title="Horários e informações"
                aria-label="Horários e informações"
                id="btn-store-info-header"
              >
                <KomaInfoIcon size={15} />
              </button>

              {/* Benefícios (Ofertas, Créditos, Pontos) - desktop */}
              {(activeBrand.benefits?.coupons || activeBrand.benefits?.loyalty) && onBenefitsClick && (
                <button
                  type="button"
                  onClick={onBenefitsClick}
                  className="koma-art-action-pill koma-art-action-pill--benefits hidden md:inline-flex"
                  title="Ofertas, créditos e pontos"
                  aria-label="Abrir benefícios do restaurante"
                  id="btn-benefits-header"
                >
                  <Gift className="w-3.5 h-3.5" />
                  <span className="koma-art-pill-text hidden sm:inline">Benefícios</span>
                </button>
              )}

              {/* Peça novamente (quando cliente logado) */}
              {user && onAuthClick && (
                <button
                  type="button"
                  onClick={onAuthClick}
                  className="koma-art-action-pill koma-art-action-pill--repeat hidden lg:inline-flex"
                  id="btn-order-again-home"
                  title="Abrir seus pedidos para pedir novamente"
                  aria-label="Abrir seus pedidos para pedir novamente"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="koma-art-pill-text hidden md:inline">Peça novamente</span>
                </button>
              )}

              {/* Acompanhar pedidos e Chat do KÔMA - desktop */}
              {storedOrdersCount > 0 && onOrdersClick && (
                <button
                  type="button"
                  onClick={onOrdersClick}
                  className="koma-art-action-pill koma-art-action-pill--orders hidden md:inline-flex"
                  title="Abrir acompanhamento e chat dos pedidos"
                  aria-label={`Abrir acompanhamento e chat dos pedidos${activeOrdersCount > 0 ? `, ${activeOrdersCount} em andamento` : ''}`}
                  id="btn-my-orders-header"
                >
                  <KomaOrderChatIcon size={15} />
                  <span className="koma-art-pill-text hidden sm:inline">
                    {activeOrdersCount > 0 ? `Pedido (${activeOrdersCount})` : 'Pedidos'}
                  </span>
                  {activeOrdersCount > 0 && (
                    <span className="koma-art-cart-badge">{activeOrdersCount}</span>
                  )}
                </button>
              )}

              {/* Login / Perfil do Cliente */}
              {onAuthClick && (
                <button
                  type="button"
                  onClick={onAuthClick}
                  className="koma-art-action-pill koma-art-action-pill--auth"
                  id={user ? 'btn-user-profile' : 'btn-login-trigger'}
                  title={user ? user.name || 'Perfil' : 'Entrar na conta'}
                  aria-label={user ? user.name || 'Perfil' : 'Entrar na conta'}
                >
                  <KomaUserIcon size={15} />
                  <span className="koma-art-pill-text hidden sm:inline">
                    {user ? user.name?.split(' ')[0] || 'Perfil' : 'Entrar'}
                  </span>
                </button>
              )}

              {/* Sacola */}
              <button
                type="button"
                onClick={onCartToggle}
                className="koma-art-action-pill koma-art-action-pill--cart"
                title="Ver sacola"
                aria-label={cartCount === 1 ? 'Sua sacola, 1 item' : `Sua sacola, ${cartCount} itens`}
                id="btn-cart-header"
              >
                <KomaBagIcon size={16} />
                {cartCount > 0 && (
                  <span className="koma-art-cart-badge">{cartCount > 99 ? '99+' : cartCount}</span>
                )}
              </button>
            </div>
          </div>

          {/* Toast de Compartilhamento */}
          {shareToastVisible && (
            <div className="koma-art-share-toast" role="status" aria-live="polite">
              <span>Link do cardápio copiado!</span>
            </div>
          )}

          {/* Cápsula de Busca Integrada */}
          <div className="koma-art-search-wrap">
            <label className="koma-art-search-capsule" id="search-bar-wrapper">
              <KomaSearchIcon size={16} className="text-emerald-400 shrink-0 ml-1" />
              <input
                type="search"
                id="input-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por prato, ingrediente ou bebida..."
                className="koma-art-search-input"
                aria-label="Campo de busca de produtos"
                autoComplete="off"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="koma-art-search-clear"
                  aria-label="Limpar busca"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </label>
          </div>

          {/* Barra de Hospitalidade Integrada */}
          <div className="koma-art-hospitality-strip">
            <div className="koma-art-hospitality-status">
              <span className="koma-art-pulse-dot" aria-hidden="true" />
              <span className="koma-art-status-text">
                {activeBrand.storeStatus === 'closed' ? 'Fechado no momento' : 'Aberto para pedidos'}
              </span>
            </div>
            <span className="koma-art-hospitality-sep">•</span>
            <span className="koma-art-hospitality-detail">
              {activeBrand.deliveryEnabled ? 'Entrega & Retirada' : 'Somente retirada'}
            </span>
            {activeBrand.pedidoMinimo ? (
              <>
                <span className="koma-art-hospitality-sep">•</span>
                <span className="koma-art-hospitality-detail">Mín. {formatPrice(activeBrand.pedidoMinimo)}</span>
              </>
            ) : null}
            <button
              type="button"
              onClick={onStoreInfoClick}
              className="koma-art-hospitality-btn"
            >
              Taxas e horários <ArrowRight className="w-3 h-3 ml-0.5 inline-block" />
            </button>
          </div>
        </div>

        {/* Onda Orgânica Escultural (Divisora Macro entre Dossel e Palco) */}
        <div className="koma-art-wave-boundary" aria-hidden="true">
          <svg
            viewBox="0 0 1440 120"
            preserveAspectRatio="none"
            className="koma-art-wave-svg"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M0 0C240 70 480 115 720 85C960 55 1200 95 1440 40V120H0V0Z"
              className="koma-art-wave-fill"
            />
          </svg>
        </div>
      </header>

      {/* ========================================================
          BANNER MULTITENANT CUSTOMIZADO (QUANDO HABILITADO)
          ======================================================== */}
      {activeBrand.hasCustomBanner && activeBrand.bannerImage && (
        <section id="brand-banner-hero" aria-label="Capa do restaurante" className="koma-art-brand-banner">
          <img
            src={activeBrand.bannerImage}
            alt={`${activeBrand.name} — banner`}
            className="koma-art-banner-img"
          />
        </section>
      )}

      {/* ========================================================
          AVISO DE INDISPONIBILIDADE / HORÁRIO FECHADO
          ======================================================== */}
      {activeBrand.storeStatus === 'closed' && (
        <div id="menu-availability" className="koma-art-availability-note cardapio-availability-note" role="status">
          <strong>
            {activeBrand.availabilitySource === 'schedule'
              ? activeBrand.nextOpeningLabel
                ? `Estabelecimento fechado. Abre ${activeBrand.nextOpeningLabel}.`
                : 'Estabelecimento fechado.'
              : activeBrand.availabilitySource === 'cash_closed'
                ? 'Estabelecimento fechado. Aguardando abertura do caixa.'
                : 'Pedidos pausados.'}
          </strong>
          {!['schedule', 'cash_closed'].includes(activeBrand.availabilitySource || '') && orderingMessage
            ? ` ${orderingMessage} `
            : ' '}
          O cardápio continua disponível para consulta.
        </div>
      )}

      {/* ========================================================
          ACOMPANHAMENTO AO VIVO DO PEDIDO ATIVO COM CHAT DIRETO
          ======================================================== */}
      {activeOrder && activeState && (
        <section
          className={`koma-art-order-tracker ${
            activeState.rejected
              ? 'koma-art-order-tracker--rejected'
              : activeState.terminal
                ? 'koma-art-order-tracker--terminal'
                : 'koma-art-order-tracker--active'
          }`}
          id="active-order-banner"
          aria-label={`Acompanhamento do Pedido #${activeOrder.numero_pedido}`}
        >
          {storedOrders && storedOrders.length > 1 && (
            <div className="koma-art-tracker-tabs">
              <div className="koma-art-tracker-tabs-scroll">
                {storedOrders.map((ord) => {
                  const isSelected = ord.id === activeOrder.id;
                  return (
                    <button
                      key={ord.id}
                      type="button"
                      onClick={() => onSelectOrderId?.(ord.id)}
                      className={`koma-art-tracker-tab-pill ${isSelected ? 'is-selected' : ''}`}
                    >
                      <span>Pedido #{ord.numero_pedido}</span>
                      {isSelected && <span className="koma-art-tracker-tab-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              {onOrdersClick && (
                <button
                  type="button"
                  onClick={onOrdersClick}
                  className="koma-art-tracker-view-all"
                >
                  Ver todos ({storedOrders.length})
                </button>
              )}
            </div>
          )}

          <div className="koma-art-tracker-main">
            <div className="koma-art-tracker-status-box">
              <div className="koma-art-tracker-badge">
                <span className="koma-art-tracker-num">PEDIDO #{activeOrder.numero_pedido}</span>
                {storedOrders && storedOrders.length > 1 && onOrdersClick && (
                  <button
                    type="button"
                    onClick={onOrdersClick}
                    className="koma-art-tracker-sublink"
                  >
                    {activeOrdersCount > 1 ? `${activeOrdersCount} em andamento` : 'Meus pedidos'}
                  </button>
                )}
              </div>
              <h2 className="koma-art-tracker-title">{activeState.label}</h2>
              <p className="koma-art-tracker-desc">
                {activeState.rejected
                  ? 'O restaurante não conseguiu aceitar este pedido. Você pode montar um novo pedido quando quiser.'
                  : activeState.terminal
                    ? 'Este pedido foi concluído. O resumo continua aqui até você iniciar outro acompanhamento.'
                    : activeState.phase === 'payment_pending'
                      ? 'O Pix ainda não foi confirmado. Assim que o pagamento for aprovado, o restaurante poderá aceitar o pedido.'
                      : activeState.progress_step === 1
                        ? 'O pedido entrou na operação e está aguardando o aceite do restaurante.'
                        : 'O restaurante já atualizou o andamento do seu pedido.'}
              </p>
              <div className="koma-art-tracker-meta">
                <span>{orderFulfillmentLabel(activeState.fulfillment)}</span>
                <span className="koma-art-tracker-sep">·</span>
                <strong>{formatPrice(activeOrder.total || 0)}</strong>
              </div>
            </div>

            <div className="koma-art-tracker-actions">
              {activeState.phase === 'payment_pending' && activeOrder.pagamento?.qr_code && onPayPixClick && (
                <button
                  type="button"
                  onClick={() => onPayPixClick(activeOrder)}
                  className="koma-art-tracker-btn koma-art-tracker-btn--pix"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Pagar Pix</span>
                </button>
              )}
              {onOrdersClick && (
                <button
                  type="button"
                  onClick={onOrdersClick}
                  className="koma-art-tracker-btn koma-art-tracker-btn--chat"
                  title="Abrir chat do pedido com o restaurante"
                >
                  <KomaOrderChatIcon size={14} />
                  <span>Chat com restaurante</span>
                </button>
              )}
              {!activeState.terminal && onRefreshOrders && (
                <button
                  type="button"
                  onClick={onRefreshOrders}
                  disabled={isRefreshingOrders}
                  className="koma-art-tracker-btn koma-art-tracker-btn--refresh"
                  title="Atualizar status"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingOrders ? 'animate-spin text-emerald-400' : ''}`} />
                  <span>Atualizar</span>
                </button>
              )}
              {activeState.terminal && onClearTrackedOrder && (
                <button
                  type="button"
                  onClick={() => onClearTrackedOrder(activeOrder.id)}
                  className="koma-art-tracker-btn koma-art-tracker-btn--new"
                >
                  Fazer novo pedido
                </button>
              )}
            </div>
          </div>

          {!activeState.rejected && activeState.phase === 'payment_pending' ? (
            <div className="koma-art-tracker-pix-note">
              <QrCode className="w-4 h-4 shrink-0 text-amber-400" />
              <div>
                <strong>Primeiro: confirme o Pix</strong>
                <p>O andamento do preparo começa depois da confirmação automática do pagamento.</p>
              </div>
            </div>
          ) : !activeState.rejected ? (
            <div
              className={`koma-art-tracker-stepper ${
                activeState.fulfillment === 'delivery' ? 'is-delivery' : 'is-takeout'
              }`}
            >
              {(activeState.fulfillment === 'delivery'
                ? ['Recebido', 'Em preparo', 'Pronto', 'Saiu para entrega', 'Concluído']
                : ['Recebido', 'Em preparo', 'Pronto', 'Concluído']
              ).map((label, index) => {
                const step = index + 1;
                const passed = (activeState.progress_step ?? 1) >= step;
                return (
                  <div key={label} className={`koma-art-step-node ${passed ? 'is-passed' : ''}`}>
                    <div className="koma-art-step-bar" />
                    <span className="koma-art-step-label">{label}</span>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>
      )}

      {/* ========================================================
          ZONA 2: FITA ORGÂNICA DE CATEGORIAS (STICKY E FLUIDA)
          ======================================================== */}
      <nav className="koma-art-category-bar" aria-label="Categorias do cardápio" id="koma-art-category-nav">
        <div className="koma-art-category-scroll">
          <button
            type="button"
            onClick={() => {
              onSelectCategory('');
              const el = document.getElementById(offers.length > 0 ? 'cardapio-promotions-home' : 'koma-art-hero-showcase');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className={`koma-art-category-pill ${!selectedCategory ? 'is-active' : ''}`}
          >
            ★ Destaques
          </button>
          {visibleCategories.map((cat) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => {
                  onSelectCategory(cat);
                  const el = document.getElementById(`cat-${cat.toLowerCase().replace(/\s+/g, '-')}`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={`koma-art-category-pill ${isActive ? 'is-active' : ''}`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ========================================================
          PROMOÇÕES VIGENTES DA CASA (OFERTAS POR COMPOSIÇÃO)
          ======================================================== */}
      {offers.length > 0 && !searchQuery && (
        <section
          aria-label="Promoções"
          className="koma-art-promotions-section"
          id="cardapio-promotions-home"
        >
          <div className="koma-art-promo-head">
            <div className="koma-art-promo-head-left">
              <span className="koma-art-promo-badge">
                <Gift className="w-3.5 h-3.5 text-amber-300 mr-1.5" />
                <span>OFERTAS ESPECIAIS</span>
              </span>
              <h2 className="koma-art-promo-title">Promoções da Casa</h2>
              <p className="koma-art-promo-subtitle">
                Monte cada item por etapas e aproveite o preço especial de combo.
              </p>
            </div>
          </div>

          <div className="koma-art-promo-grid">
            {offers.map((offer) => {
              const offerImage = offer.componentes
                ?.flat()
                .map((id) =>
                  [...activeBrand.products, ...(activeBrand.promotionProducts || [])].find(
                    (product) => product.id === id
                  )?.image
                )
                .find((img) => img && img !== LOCAL_PRODUCT_PLACEHOLDER);

              return (
                <div
                  key={offer.id}
                  className="koma-art-promo-card"
                  onClick={() => onPromotionSelect?.(offer)}
                >
                  <div className="koma-art-promo-media">
                    {offerImage ? (
                      <CatalogProductImage
                        image={offerImage}
                        alt={offer.nome}
                        className="koma-art-promo-img"
                      />
                    ) : (
                      <ArtisticClocheIllustration />
                    )}
                    <span className="koma-art-promo-tag">COMBO PROMOCIONAL</span>
                  </div>

                  <div className="koma-art-promo-content">
                    <div className="koma-art-promo-copy">
                      <span className="koma-art-promo-eyebrow">Oferta da casa</span>
                      <h3 className="koma-art-promo-name">{offer.nome}</h3>
                      {offer.descricao && (
                        <p className="koma-art-promo-desc">{offer.descricao}</p>
                      )}
                    </div>

                    <div className="koma-art-promo-footer">
                      <div className="koma-art-promo-price-box">
                        <span className="koma-art-promo-price-label">Preço do combo</span>
                        <strong className="koma-art-promo-price-val">
                          {formatPrice(offer.preco)}
                        </strong>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPromotionSelect?.(offer);
                        }}
                        className="koma-art-promo-cta"
                        aria-label={`Montar promoção ${offer.nome} por ${formatPrice(offer.preco)}`}
                      >
                        <span>Montar</span>
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ========================================================
          ZONA 3: PALCO CULINÁRIO ARQUITETURAL (HERO STAR SHOWCASE)
          Quando houver promoções ativas, elas tomam o destaque principal,
          evitando empilhar dois heróis gigantescos consecutivamente.
          ======================================================== */}
      {heroProduct && !searchQuery && offers.length === 0 && (
        <section
          className="koma-art-hero-stage"
          id="koma-art-hero-showcase"
          aria-label="Prato em destaque"
        >
          <div className="koma-art-stage-pod">
            {/* Moldura Arquitetural da Fotografia */}
            <div className="koma-art-arch-window" onClick={() => onSelectProduct(heroProduct)}>
              {heroProduct.image ? (
                <CatalogProductImage
                  image={heroProduct.image}
                  alt={heroProduct.name}
                  className="koma-art-arch-img"
                />
              ) : (
                <ArtisticClocheIllustration />
              )}
              {/* Selo Destaque / Ranking */}
              <div className="koma-art-seal-crown" role="status">
                {isVerifiedTopRanked ? (
                  <>
                    <Crown className="w-3.5 h-3.5 text-amber-300 mr-1" />
                    <span>Nº 1 MAIS PEDIDO</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5 text-emerald-400 mr-1" />
                    <span>DESTAQUE DO CARDÁPIO</span>
                  </>
                )}
              </div>
              {/* Gradiente de Fusão Atmosférica na base da foto */}
              <div className="koma-art-arch-melt" aria-hidden="true" />
            </div>

            {/* Conteúdo Editorial do Palco */}
            <div className="koma-art-stage-body">
              <div className="koma-art-stage-headline">
                <span className="koma-art-stage-eyebrow">
                  {isVerifiedTopRanked ? '★ ITEM MAIS PEDIDO' : '★ DESTAQUE DA CASA'}
                </span>
                <h2
                  className="koma-art-stage-title"
                  onClick={() => onSelectProduct(heroProduct)}
                >
                  {heroProduct.name}
                </h2>
                {heroProduct.description && (
                  <p className="koma-art-stage-desc">{heroProduct.description}</p>
                )}
              </div>

              {/* Bloco de Preço & Ação Tátil */}
              <div className="koma-art-stage-action-row">
                <div className="koma-art-stage-price-box">
                  <span className="koma-art-stage-price-label">Valor</span>
                  <strong className="koma-art-stage-price-val">{formatPrice(heroProduct.price)}</strong>
                </div>

                {heroCartQty > 0 ? (
                  <div className="koma-art-stepper-capsule">
                    <button
                      type="button"
                      onClick={(e) => onFastRemove(heroProduct, e)}
                      className="koma-art-stepper-btn"
                      id={`btn-fast-dec-${heroProduct.id}`}
                      aria-label="Diminuir quantidade"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="koma-art-stepper-count" id={`qty-${heroProduct.id}`}>
                      {heroCartQty}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => onFastAdd(heroProduct, e)}
                      className="koma-art-stepper-btn"
                      id={`btn-fast-inc-${heroProduct.id}`}
                      aria-label="Aumentar quantidade"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      if (
                        (heroProduct.modifierGroups && heroProduct.modifierGroups.length > 0) ||
                        (heroProduct.modifiers && heroProduct.modifiers.length > 0)
                      ) {
                        onSelectProduct(heroProduct);
                      } else {
                        onFastAdd(heroProduct, e);
                      }
                    }}
                    className="koma-art-cta-pill"
                    id={`btn-fast-add-${heroProduct.id}`}
                    aria-label={`Pedir ${heroProduct.name}`}
                  >
                    <span>Pedir agora</span>
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ========================================================
          ZONA 4: CÁPSULAS DE HARMONIZAÇÃO ("COMBINA COM SEU PEDIDO")
          ======================================================== */}
      {pairingProducts.length > 0 && !searchQuery && (
        <section
          className="koma-art-pairing-section"
          aria-label="Harmonizações sugeridas"
          id="cardapio-recommendations-home"
        >
          <div className="koma-art-section-head">
            <div>
              <span className="koma-art-section-eyebrow">SUGESTÕES COMPLEMENTARES</span>
              <h3 className="koma-art-section-title">Combina com seu pedido</h3>
            </div>
            <span className="koma-art-pairing-hint">Opções para acompanhar</span>
          </div>

          <div className="koma-art-pairing-grid">
            {pairingProducts.map((item) => {
              const qty = getProductCartQuantity(item.id);
              const hasMods = Boolean(
                (item.modifierGroups && item.modifierGroups.length > 0) ||
                (item.modifiers && item.modifiers.length > 0)
              );
              return (
                <div
                  key={item.id}
                  id={`product-card-${item.id}`}
                  className="koma-art-pebble-card"
                  onClick={() => onSelectProduct(item)}
                >
                  <div className="koma-art-pebble-media">
                    {item.image ? (
                      <CatalogProductImage
                        image={item.image}
                        alt={item.name}
                        className="koma-art-pebble-img"
                      />
                    ) : (
                      <ArtisticClocheIllustration />
                    )}
                    <span className="koma-art-pebble-tag">{item.category || 'Sugestão'}</span>
                  </div>

                  <div className="koma-art-pebble-content">
                    <h4 className="koma-art-pebble-title">{item.name}</h4>
                    <div className="koma-art-pebble-footer">
                      <span className="koma-art-pebble-price">{formatPrice(item.price)}</span>
                      {qty > 0 ? (
                        <div
                          className="koma-art-pebble-stepper"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={(e) => onFastRemove(item, e)}
                            className="koma-art-pebble-step-btn"
                            id={`btn-fast-dec-${item.id}`}
                            aria-label={`Diminuir ${item.name}`}
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="koma-art-pebble-qty" id={`qty-${item.id}`}>{qty}</span>
                          <button
                            type="button"
                            onClick={(e) => onFastAdd(item, e)}
                            className="koma-art-pebble-step-btn"
                            id={`btn-fast-inc-${item.id}`}
                            aria-label={`Aumentar ${item.name}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (hasMods) {
                              onSelectProduct(item);
                            } else {
                              onFastAdd(item, e);
                            }
                          }}
                          className="koma-art-pebble-add-btn"
                          id={`btn-fast-add-${item.id}`}
                          aria-label={`Adicionar ${item.name}`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ========================================================
          ZONA 5: CATÁLOGO INDEXADO EDITORIALMENTE
          ======================================================== */}
      <main className="koma-art-catalog-main" id="koma-art-catalog">
        {visibleCategories.map((category, catIndex) => {
          const catProducts = filteredProducts.filter((p) => p.category === category);
          const indexFormatted = String(catIndex + 1).padStart(2, '0');
          const catDomId = `cat-${category.toLowerCase().replace(/\s+/g, '-')}`;

          return (
            <section key={category} id={catDomId} className="koma-art-cat-group">
              {/* Marcador Monumental da Categoria */}
              <div className="koma-art-cat-monument">
                <span className="koma-art-cat-watermark" aria-hidden="true">
                  {indexFormatted}
                </span>
                <div className="koma-art-cat-monument__info">
                  <h3 className="koma-art-cat-monument__title">{category}</h3>
                  <span className="koma-art-cat-monument__count">
                    {catProducts.length} {catProducts.length === 1 ? 'item' : 'itens'}
                  </span>
                </div>
              </div>

              {/* Grade de Cards do Catálogo */}
              <div className="koma-art-catalog-grid">
                {catProducts.map((product) => {
                  const qty = getProductCartQuantity(product.id);
                  const isAvail = product.isAvailable !== false;
                  const hasMods = Boolean(
                    (product.modifierGroups && product.modifierGroups.length > 0) ||
                    (product.modifiers && product.modifiers.length > 0)
                  );

                  return (
                    <article
                      key={product.id}
                      id={`product-card-${product.id}`}
                      className={`koma-art-catalog-card ${isAvail ? 'is-available' : 'is-unavailable'}`}
                      onClick={() => {
                        if (isAvail) onSelectProduct(product);
                      }}
                    >
                      <div className="koma-art-card-left">
                        <div className="flex items-center gap-2">
                          <h4 className="koma-art-card-title">{product.name}</h4>
                          {!isAvail && (
                            <span className="rounded-md bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-rose-400">
                              Esgotado
                            </span>
                          )}
                        </div>
                        {product.description && (
                          <p className="koma-art-card-desc">{product.description}</p>
                        )}
                        <div className="koma-art-card-pricing-row">
                          <strong className="koma-art-card-price">{formatPrice(product.price)}</strong>
                          {isAvail && (qty > 0 ? (
                            <div
                              className="koma-art-card-stepper"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => onFastRemove(product, e)}
                                className="koma-art-card-step-btn"
                                id={`btn-fast-dec-${product.id}`}
                                aria-label={`Diminuir ${product.name}`}
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="koma-art-card-qty" id={`qty-${product.id}`}>
                                {qty}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => onFastAdd(product, e)}
                                className="koma-art-card-step-btn"
                                id={`btn-fast-inc-${product.id}`}
                                aria-label={`Aumentar ${product.name}`}
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasMods) {
                                  onSelectProduct(product);
                                } else {
                                  onFastAdd(product, e);
                                }
                              }}
                              className="koma-art-card-add-btn"
                              id={`btn-fast-add-${product.id}`}
                              aria-label={`Adicionar ${product.name}`}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="koma-art-card-media-pod">
                        {product.image ? (
                          <CatalogProductImage
                            image={product.image}
                            alt={product.name}
                            className="koma-art-card-img"
                          />
                        ) : (
                          <ArtisticClocheIllustration />
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </main>

      {/* ========================================================
          RODAPÉ EDITORIAL COM ATRIBUIÇÃO OFICIAL KÔMA
          ======================================================== */}
      <footer className="koma-art-footer">
        <strong className="koma-art-footer-name">{activeBrand.name}</strong>
        <p className="koma-art-footer-copy">Preços e disponibilidade atualizados pelo restaurante.</p>
        <a
          href={buildKomaAttributionUrl('menu_footer', activeBrand.id)}
          target="_blank"
          rel="noopener noreferrer"
          id="koma-powered-by-footer"
          aria-label="Conhecer o KÔMA, plataforma deste cardápio digital"
          className="koma-art-powered-pill koma-art-attribution-link"
        >
          <span className="koma-art-attribution-emblem" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 4C7.03 4 3 8.03 3 13H21C21 8.03 16.97 4 12 4Z" fill="#10B981" />
              <path d="M2 17H22V19H2V17Z" fill="#10B981" />
              <circle cx="12" cy="2.5" r="1.5" fill="#10B981" />
            </svg>
          </span>
          <span>Cardápio digital por <strong>KÔMA</strong></span>
          <span className="koma-art-attribution-arrow" aria-hidden="true">↗</span>
        </a>
      </footer>

      {/* ========================================================
          DOCK ERGONÔMICO FLUTUANTE (MOBILE-FIRST)
          ======================================================== */}
      {!hasOpenOverlay && (
        <nav className="koma-art-dock" aria-label="Navegação rápida" id="koma-art-dock">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="koma-art-dock-btn"
            id="mobile-nav-home"
            aria-label="Voltar ao início"
          >
            <House className="w-4 h-4" />
            <span>Início</span>
          </button>

          {onOrdersClick && (
            <button
              type="button"
              onClick={onOrdersClick}
              className="koma-art-dock-btn"
              id="mobile-nav-orders"
              aria-label={`Abrir pedidos e chat${activeOrdersCount > 0 ? `, ${activeOrdersCount} ativos` : ''}`}
            >
              <KomaOrderChatIcon size={16} />
              <span>Pedidos</span>
              {activeOrdersCount > 0 && (
                <span className="koma-art-dock-badge">
                  {activeOrdersCount > 9 ? '9+' : activeOrdersCount}
                </span>
              )}
            </button>
          )}

          {(activeBrand.benefits?.coupons || activeBrand.benefits?.loyalty) && onBenefitsClick && (
            <button
              type="button"
              onClick={onBenefitsClick}
              className="koma-art-dock-btn"
              id="mobile-nav-benefits"
              aria-label="Abrir benefícios"
            >
              <Gift className="w-4 h-4" />
              <span>Benefícios</span>
            </button>
          )}

          <button
            type="button"
            onClick={onCartToggle}
            className="koma-art-dock-btn koma-art-dock-btn--bag"
            aria-label={`Abrir sacola com ${cartCount} ${cartCount === 1 ? 'item' : 'itens'}`}
            id="mobile-nav-cart"
          >
            <div className="koma-art-dock-bag-icon">
              <KomaBagIcon size={16} />
              {cartCount > 0 && (
                <span className="koma-art-dock-badge">{cartCount > 9 ? '9+' : cartCount}</span>
              )}
            </div>
            <div className="koma-art-dock-bag-text">
              <span>Sacola</span>
              {cartTotal > 0 && <small>Subtotal: {formatPrice(cartTotal)}</small>}
            </div>
          </button>
        </nav>
      )}
    </div>
  );
}

export default CardapioArtisticExperience;
