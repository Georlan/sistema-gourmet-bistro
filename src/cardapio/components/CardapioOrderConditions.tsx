import React from 'react';
import { ArrowRight, Truck } from 'lucide-react';
import type { BrandConfig } from '../CardapioTypes';

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export function CardapioConditionsSummary({ brand, onOpen }: { brand: BrandConfig; onOpen: () => void }) {
  return (
    <section aria-label="Condições do pedido" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-koma-border bg-koma-card px-4 py-2">
      {(brand.pedidoMinimo ?? 0) > 0 ? (
        <div className="min-w-0 py-1"><span className="block text-xs text-koma-muted">Pedido mínimo</span><strong className="mt-0.5 block text-sm text-koma-foreground">{money(brand.pedidoMinimo!)}</strong></div>
      ) : <span className="text-xs font-semibold text-koma-secondary">Entrega e retirada</span>}
      <button type="button" aria-label="Ver taxas de entrega" onClick={onOpen} className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-1 text-left text-xs font-bold text-emerald-500 transition hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500">
        <span>Taxas de entrega</span><ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
    </section>
  );
}

export function CardapioDeliveryInfo({ brand }: { brand: BrandConfig }) {
  const neighborhoods = brand.tabelaTaxasBairros ?? [];
  return (
    <section aria-labelledby="store-delivery-title">
      <h3 id="store-delivery-title" className="flex items-center gap-2 text-sm font-bold text-koma-foreground"><Truck className="h-4 w-4 text-emerald-500" aria-hidden="true" />Entrega e retirada</h3>
      {(brand.pedidoMinimo ?? 0) > 0 && <p className="mt-3 text-xs leading-relaxed text-koma-secondary">Pedido mínimo: <strong>{money(brand.pedidoMinimo!)}</strong> em produtos.</p>}
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
