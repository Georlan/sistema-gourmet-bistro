/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import {
  Search,
  ShoppingBag,
  Info,
  Share2,
  Plus,
  Minus,
  Crown,
  Sparkles,
  ArrowRight,
  Clock,
  House,
  MessageCircle,
  X,
} from 'lucide-react';
import { BrandConfig, Product } from '../CardapioTypes';
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
  onStoreInfoClick: () => void;
  onOrdersClick?: () => void;
  activeOrdersCount?: number;
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
      <span className="koma-art-cloche__caption">Receita autoral</span>
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
  onStoreInfoClick,
  onOrdersClick,
  activeOrdersCount = 0,
}: CardapioArtisticExperienceProps) {
  // Compartilhar cardápio
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
        // ignore
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch {
        // ignore
      }
    }
  };

  // Identificação do produto Hero (seleciona o #1 em vendas ou o primeiro com foto)
  const heroProduct = useMemo<Product | null>(() => {
    if (!activeBrand.products || activeBrand.products.length === 0) return null;
    if (activeBrand.popularProductIds && activeBrand.popularProductIds.length > 0) {
      const topId = String(activeBrand.popularProductIds[0]);
      const found = activeBrand.products.find((p) => String(p.id) === topId);
      if (found) return found;
    }
    return activeBrand.products[0] || null;
  }, [activeBrand.products, activeBrand.popularProductIds]);

  // Produtos de harmonização / recomendação complementar (exclui o hero para não haver repetição)
  const pairingProducts = useMemo<Product[]>(() => {
    if (!activeBrand.products) return [];
    return activeBrand.products
      .filter((p) => p.id !== heroProduct?.id)
      .slice(0, 4);
  }, [activeBrand.products, heroProduct]);

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
            >
              {activeBrand.logo ? (
                <img src={activeBrand.logo} alt={activeBrand.name} className="koma-art-brand-logo" />
              ) : (
                <div className="koma-art-brand-logo--fallback">K</div>
              )}
              <div className="koma-art-brand-text">
                <span className="koma-art-brand-name">{activeBrand.name}</span>
                <span className="koma-art-brand-slogan">{activeBrand.slogan || 'Alta gastronomia artesanal'}</span>
              </div>
            </button>

            <div className="koma-art-canopy__actions">
              <button
                type="button"
                onClick={handleShare}
                className="koma-art-action-pill"
                title="Compartilhar cardápio"
                aria-label="Compartilhar cardápio"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onStoreInfoClick}
                className="koma-art-action-pill"
                title="Horários e informações"
                aria-label="Horários e informações"
              >
                <Info className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onCartToggle}
                className="koma-art-action-pill koma-art-action-pill--cart"
                title="Ver sacola"
                aria-label="Ver sacola de compras"
              >
                <ShoppingBag className="w-4 h-4" />
                {cartCount > 0 && <span className="koma-art-cart-badge">{cartCount}</span>}
              </button>
            </div>
          </div>

          {/* Cápsula de Busca Integrada */}
          <div className="koma-art-search-wrap">
            <div className="koma-art-search-capsule">
              <Search className="w-4 h-4 text-emerald-400 shrink-0 ml-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por prato, ingrediente ou bebida..."
                className="koma-art-search-input"
                aria-label="Campo de busca de produtos"
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
            </div>
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
          ZONA 2: FITA ORGÂNICA DE CATEGORIAS (STICKY E FLUIDA)
          ======================================================== */}
      <nav className="koma-art-category-bar" aria-label="Categorias do cardápio" id="koma-art-category-nav">
        <div className="koma-art-category-scroll">
          <button
            type="button"
            onClick={() => {
              onSelectCategory('');
              const el = document.getElementById('koma-art-hero-showcase');
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
          ZONA 3: PALCO CULINÁRIO ARQUITETURAL (HERO STAR SHOWCASE)
          ======================================================== */}
      {heroProduct && !searchQuery && (
        <section
          className="koma-art-hero-stage"
          id="koma-art-hero-showcase"
          aria-label="Prato em destaque"
        >
          <div className="koma-art-stage-pod">
            {/* Moldura Arquitetural da Fotografia */}
            <div className="koma-art-arch-window" onClick={() => onSelectProduct(heroProduct)}>
              {heroProduct.image ? (
                <img
                  src={heroProduct.image}
                  alt={heroProduct.name}
                  className="koma-art-arch-img"
                  loading="eager"
                />
              ) : (
                <ArtisticClocheIllustration />
              )}
              {/* Selo Coroa Flutuante */}
              <div className="koma-art-seal-crown" role="status">
                <Crown className="w-3.5 h-3.5 text-amber-300 mr-1" />
                <span>Nº 1 MAIS PEDIDO</span>
              </div>
              {/* Gradiente de Fusão Atmosférica na base da foto */}
              <div className="koma-art-arch-melt" aria-hidden="true" />
            </div>

            {/* Conteúdo Editorial do Palco */}
            <div className="koma-art-stage-body">
              <div className="koma-art-stage-headline">
                <span className="koma-art-stage-eyebrow">★ RECOMENDAÇÃO DO CHEF</span>
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
                      aria-label="Diminuir quantidade"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className="koma-art-stepper-count">{heroCartQty}</span>
                    <button
                      type="button"
                      onClick={(e) => onFastAdd(heroProduct, e)}
                      className="koma-art-stepper-btn"
                      aria-label="Aumentar quantidade"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      if (heroProduct.modifierGroups && heroProduct.modifierGroups.length > 0) {
                        onSelectProduct(heroProduct);
                      } else {
                        onFastAdd(heroProduct, e);
                      }
                    }}
                    className="koma-art-cta-pill"
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
        <section className="koma-art-pairing-section" aria-label="Harmonizações sugeridas">
          <div className="koma-art-section-head">
            <div>
              <span className="koma-art-section-eyebrow">CURADORIA DA CASA</span>
              <h3 className="koma-art-section-title">Combina com seu pedido</h3>
            </div>
            <span className="koma-art-pairing-hint">Harmonizações perfeitas</span>
          </div>

          <div className="koma-art-pairing-grid">
            {pairingProducts.map((item) => {
              const qty = getProductCartQuantity(item.id);
              return (
                <div
                  key={item.id}
                  className="koma-art-pebble-card"
                  onClick={() => onSelectProduct(item)}
                >
                  <div className="koma-art-pebble-media">
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="koma-art-pebble-img" loading="lazy" />
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
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="koma-art-pebble-qty">{qty}</span>
                          <button
                            type="button"
                            onClick={(e) => onFastAdd(item, e)}
                            className="koma-art-pebble-step-btn"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (item.modifierGroups && item.modifierGroups.length > 0) {
                              onSelectProduct(item);
                            } else {
                              onFastAdd(item, e);
                            }
                          }}
                          className="koma-art-pebble-add-btn"
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
                  return (
                    <article
                      key={product.id}
                      className="koma-art-catalog-card"
                      onClick={() => onSelectProduct(product)}
                    >
                      <div className="koma-art-card-left">
                        <h4 className="koma-art-card-title">{product.name}</h4>
                        {product.description && (
                          <p className="koma-art-card-desc">{product.description}</p>
                        )}
                        <div className="koma-art-card-pricing-row">
                          <strong className="koma-art-card-price">{formatPrice(product.price)}</strong>
                          {qty > 0 ? (
                            <div
                              className="koma-art-card-stepper"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={(e) => onFastRemove(product, e)}
                                className="koma-art-card-step-btn"
                                aria-label="Diminuir"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <span className="koma-art-card-qty">{qty}</span>
                              <button
                                type="button"
                                onClick={(e) => onFastAdd(product, e)}
                                className="koma-art-card-step-btn"
                                aria-label="Aumentar"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (product.modifierGroups && product.modifierGroups.length > 0) {
                                  onSelectProduct(product);
                                } else {
                                  onFastAdd(product, e);
                                }
                              }}
                              className="koma-art-card-add-btn"
                              aria-label={`Adicionar ${product.name}`}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="koma-art-card-media-pod">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="koma-art-card-img"
                            loading="lazy"
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
          RODAPÉ EDITORIAL
          ======================================================== */}
      <footer className="koma-art-footer">
        <strong className="koma-art-footer-name">{activeBrand.name}</strong>
        <p className="koma-art-footer-copy">Alta gastronomia preparada na hora. Preços sujeitos a alteração.</p>
        <div className="koma-art-powered-pill">
          Cardápio digital por <strong>KÔMA</strong>
        </div>
      </footer>

      {/* ========================================================
          DOCK ERGONÔMICO FLUTUANTE (MOBILE-FIRST)
          ======================================================== */}
      <nav className="koma-art-dock" aria-label="Navegação rápida">
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="koma-art-dock-btn"
        >
          <House className="w-4 h-4" />
          <span>Início</span>
        </button>

        {onOrdersClick && (
          <button
            type="button"
            onClick={onOrdersClick}
            className="koma-art-dock-btn"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Pedidos</span>
            {activeOrdersCount > 0 && (
              <span className="koma-art-dock-badge">{activeOrdersCount}</span>
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onCartToggle}
          className="koma-art-dock-btn koma-art-dock-btn--bag"
        >
          <div className="koma-art-dock-bag-icon">
            <ShoppingBag className="w-4 h-4" />
            {cartCount > 0 && <span className="koma-art-dock-badge">{cartCount}</span>}
          </div>
          <div className="koma-art-dock-bag-text">
            <span>Sacola</span>
            {cartTotal > 0 && <small>{formatPrice(cartTotal)}</small>}
          </div>
        </button>
      </nav>
    </div>
  );
}

export default CardapioArtisticExperience;
