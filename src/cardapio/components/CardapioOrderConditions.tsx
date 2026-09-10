import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Flame, Truck } from 'lucide-react';
import type { BrandConfig, Product } from '../CardapioTypes';
import { CardapioHighlights } from './CardapioHighlights';
import { CardapioRecommendations } from './CardapioRecommendations';

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
    return rankedIds.map((id) => byId.get(id)).filter((product): product is Product => Boolean(product));
  }, [brand.products, rankedIds]);

  if (products.length === 0) return null;

  const focusProduct = (product: Product) => {
    const target = document.getElementById(`product-card-${product.id}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target?.querySelector<HTMLElement>('.cardapio-product-card__details-hitbox')?.focus(), 450);
  };

  return (
    <section aria-labelledby="popular-products-title" className="w-full basis-full border-t border-koma-border pt-3" id="popular-products-home">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-emerald-500/10 text-emerald-400">
          <Flame className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="popular-products-title" className="text-sm font-black text-koma-foreground">Mais escolhidos</h2>
          <p className="text-[10px] text-koma-muted">Os favoritos recentes deste restaurante.</p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="list">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            role="listitem"
            onClick={() => focusProduct(product)}
            className="flex min-w-[210px] max-w-[250px] items-center gap-3 rounded-xl border border-koma-border bg-koma-panel p-2.5 text-left transition hover:border-emerald-500/30 hover:bg-koma-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
            aria-label={`Ver ${product.name} no cardápio`}
          >
            <img
              src={product.image}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-12 w-12 shrink-0 rounded-lg object-cover"
            />
            <span className="min-w-0">
              <strong className="block truncate text-xs text-koma-foreground">{product.name}</strong>
              <span className="mt-1 block text-xs font-black text-emerald-400">{money(product.price)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function CardapioConditionsSummary({ brand, onOpen }: { brand: BrandConfig; onOpen: () => void }) {
  const deliveryEnabled = brand.deliveryEnabled !== false;
  return (
    <section aria-label="Condições do pedido" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-koma-border bg-koma-card px-4 py-2">
      {!deliveryEnabled ? (
        <span className="text-xs font-semibold text-koma-secondary">Somente retirada</span>
      ) : (brand.pedidoMinimo ?? 0) > 0 ? (
        <div className="min-w-0 py-1"><span className="block text-xs text-koma-muted">Mínimo para entrega</span><strong className="mt-0.5 block text-sm text-koma-foreground">{money(brand.pedidoMinimo!)}</strong></div>
      ) : <span className="text-xs font-semibold text-koma-secondary">Entrega e retirada</span>}
      <button type="button" aria-label="Ver condições de entrega" onClick={onOpen} className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-1 text-left text-xs font-bold text-emerald-500 transition hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
        <span>{deliveryEnabled ? 'Taxas de entrega' : 'Ver detalhes'}</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      <CardapioHighlights brand={brand} />
      <PopularProductsPreview brand={brand} />
      <CardapioRecommendations brand={brand} />
    </section>
  );
}

export function CardapioDeliveryInfo({ brand }: { brand: BrandConfig }) {
  const neighborhoods = brand.tabelaTaxasBairros ?? [];
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
      {(brand.pedidoMinimo ?? 0) > 0 && <p className="mt-3 text-xs leading-relaxed text-koma-secondary">Pedido mínimo para entrega: <strong>{money(brand.pedidoMinimo!)}</strong> em produtos.</p>}
      {(brand.freteGratisValor ?? 0) > 0 && <p className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-relaxed text-koma-secondary">Frete grátis a partir de <strong>{money(brand.freteGratisValor!)}</strong> em produtos.</p>}
      {neighborhoods.length > 0 ? (
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
      ) : (
        <p className="mt-3 rounded-xl border border-koma-border bg-koma-card p-3 text-xs leading-relaxed text-koma-secondary">
          {Number.isFinite(brand.taxaEntregaPadrao) ? <>Taxa padrão estimada: <strong>{money(brand.taxaEntregaPadrao!)}</strong>.</> : 'Consulte a taxa de entrega na sacola.'}
        </p>
      )}
      <p className="mt-2 text-xs leading-relaxed text-koma-muted">Confira a taxa do seu endereço e o total na sacola antes de enviar o pedido.</p>
    </section>
  );
}
