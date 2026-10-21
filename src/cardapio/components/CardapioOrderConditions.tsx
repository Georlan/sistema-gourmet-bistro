import CatalogProductImage from './CatalogProductImage';
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Truck } from 'lucide-react';
import type { BrandConfig, Product } from '../CardapioTypes';
import { CardapioRecommendations } from './CardapioRecommendations';
import { CardapioHighlights } from './CardapioHighlights';
import CardapioPromotions from './CardapioPromotions';
import type { CatalogPromotion } from '../CardapioTypes';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const resolveApiBaseUrl = () => {
  const envApiUrl = (import.meta as { env?: { VITE_API_URL?: string } }).env?.VITE_API_URL;
  if (envApiUrl) return envApiUrl;
  if (typeof window !== 'undefined') {
    const { hostname, protocol } = window.location;
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    if (isLocalHost) return `${protocol}//${hostname}:8000`;
  }
  return 'https://sistema-gourmet-bistro-production.up.railway.app';
};

type PopularProductRank = {
  produto_id: string;
  escolhas: number;
};

type PopularProductsPayload = {
  produtos?: PopularProductRank[];
};

function PopularProductsPreview({ brand }: { brand: BrandConfig }) {
  const [rankedIds, setRankedIds] = useState<string[]>([]);

  useEffect(() => {
    if (!brand.id) return;
    setRankedIds([]);
    const controller = new AbortController();

    void fetch(`${resolveApiBaseUrl()}/api/cardapio-digital/populares?restaurante_id=${encodeURIComponent(brand.id)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<PopularProductsPayload>;
      })
      .then((payload) => {
        if (!payload) return;
        const ids = Array.isArray(payload.produtos)
          ? payload.produtos.map((item) => String(item.produto_id || '')).filter(Boolean)
          : [];
        setRankedIds(ids);
      })
      .catch((error) => {
        if ((error as Error)?.name !== 'AbortError') setRankedIds([]);
      });

    return () => controller.abort();
  }, [brand.id]);

  const products = useMemo(() => {
    const byId = new Map(brand.products.map((product) => [String(product.id), product]));
    return rankedIds.map((id) => byId.get(id)).filter((product): product is Product => Boolean(product) && product?.isAvailable !== false);
  }, [brand.products, rankedIds]);

  if (products.length === 0) return null;

  const openProduct = (product: Product) => {
    const target = document.getElementById(`product-card-${product.id}`);
    const detailsTrigger = target?.querySelector<HTMLButtonElement>('.cardapio-product-card__details-hitbox');
    if (detailsTrigger) {
      detailsTrigger.click();
      return;
    }
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <section aria-labelledby="popular-products-title" className="cardapio-popular-section w-full basis-full" id="popular-products-home">
      <h2 id="popular-products-title" className="cardapio-showcase-heading">Mais escolhidos</h2>
      <div className="cardapio-popular-list" role="list">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            role="listitem"
            onClick={() => openProduct(product)}
            className="cardapio-popular-card"
            aria-label={`Abrir ${product.name}`}
          >
            <CatalogProductImage
              image={product.image}
              className="cardapio-popular-card__image"
            />
            <span className="cardapio-popular-card__content">
              <strong className="cardapio-popular-card__name">{product.name}</strong>
              <span className="cardapio-popular-card__price">{money(product.price)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function CardapioConditionsSummary({ brand, onOpen, onPromotionSelect }: { brand: BrandConfig; onOpen: () => void; onPromotionSelect?: (promotion: CatalogPromotion) => void }) {
  const deliveryEnabled = brand.deliveryEnabled !== false;
  return (
    <section id="menu-highlights" aria-label="Condições do pedido" className="cardapio-conditions-summary flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {brand.storeStatus === 'open' && <span className="cardapio-order-status">Aberto</span>}
      {!deliveryEnabled ? (
        <span className="text-xs font-semibold text-koma-secondary">Somente retirada</span>
      ) : (brand.pedidoMinimo ?? 0) > 0 ? (
        <div className="min-w-0 py-1"><span className="block text-xs text-koma-muted">{brand.pedidoMinimoRetirada ? 'Pedido mínimo' : 'Mínimo para entrega'}</span><strong className="mt-0.5 block text-sm text-koma-foreground">{money(brand.pedidoMinimo!)}</strong></div>
      ) : <span className="text-xs font-semibold text-koma-secondary">Entrega e retirada</span>}
      <button type="button" aria-label="Ver condições de entrega" onClick={onOpen} className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-1 text-left text-xs font-bold text-emerald-500 transition hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
        <span>{deliveryEnabled ? 'Taxas de entrega' : 'Ver detalhes'}</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      <PopularProductsPreview brand={brand} />
      {onPromotionSelect && <CardapioPromotions brand={brand} onSelect={onPromotionSelect} />}
      <CardapioHighlights brand={brand} />
      <CardapioRecommendations brand={brand} />
    </section>
  );
}

export function CardapioDeliveryInfo({ brand }: { brand: BrandConfig }) {
  const neighborhoods = brand.tabelaTaxasBairros ?? [];
  const deliveryMode = brand.tipoTaxaEntrega
    || (neighborhoods.length > 0 ? 'bairro' : 'fixa');
  const distanceConfig = brand.tabelaTaxasKm?.[0];
  if (brand.deliveryEnabled === false) {
    return (
      <section aria-labelledby="store-delivery-title">
        <h3 id="store-delivery-title" className="flex items-center gap-2 text-sm font-bold text-koma-foreground"><Truck className="h-4 w-4 text-koma-muted" aria-hidden="true" />Somente retirada</h3>
        <p className="mt-3 rounded-xl border border-koma-border bg-koma-card p-3 text-xs leading-relaxed text-koma-secondary">A entrega está pausada no momento. Você ainda pode fazer o pedido e retirar no restaurante.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="store-delivery-title">
      <h3 id="store-delivery-title" className="flex items-center gap-2 text-sm font-bold text-koma-foreground"><Truck className="h-4 w-4 text-emerald-500" aria-hidden="true" />Entrega e retirada</h3>
      {(brand.pedidoMinimo ?? 0) > 0 && (
        <p className="mt-3 text-xs leading-relaxed text-koma-secondary">
          {brand.pedidoMinimoRetirada ? 'Pedido mínimo:' : 'Pedido mínimo para entrega:'} <strong>{money(brand.pedidoMinimo!)}</strong> em produtos.
        </p>
      )}
      {(brand.freteGratisValor ?? 0) > 0 && <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-koma-secondary">Frete grátis a partir de <strong>{money(brand.freteGratisValor!)}</strong> em produtos.</p>}
      {deliveryMode === 'bairro' && neighborhoods.length > 0 ? (
        <>
          <p className="mt-3 text-xs text-koma-muted">Taxas por bairro</p>
          <ul className="mt-2 overflow-hidden rounded-xl border border-koma-border bg-koma-card">
            {neighborhoods.map((row, index) => (
              <li key={`${row.bairro}-${index}`} className="flex items-start justify-between gap-3 border-b border-koma-border px-3 py-3 text-xs last:border-b-0">
                <span className="min-w-0 break-words leading-relaxed text-koma-secondary">{row.bairro}</span><strong className="shrink-0 text-koma-foreground">{row.taxa === 0 ? 'Grátis' : money(row.taxa)}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : deliveryMode === 'distancia' && distanceConfig ? (
        <p className="mt-3 rounded-xl border border-koma-border bg-koma-card p-3 text-xs leading-relaxed text-koma-secondary">
          Taxa de entrega a partir de <strong>{money(Number(distanceConfig.taxa_minima || 0))}</strong>.
        </p>
      ) : (
        <p className="mt-3 rounded-xl border border-koma-border bg-koma-card p-3 text-xs leading-relaxed text-koma-secondary">
          {Number.isFinite(brand.taxaEntregaPadrao) ? <>Taxa padrão estimada: <strong>{money(brand.taxaEntregaPadrao!)}</strong>.</> : 'Consulte a taxa de entrega na sacola.'}
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-koma-muted">Confira a taxa do seu endereço e o total na sacola antes de enviar o pedido.</p>
    </section>
  );
}
