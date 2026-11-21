import { useMemo, useState } from 'react';
import { Award, ChevronRight, Percent, Sparkles, Tag } from 'lucide-react';
import type { Product } from '../../../types';
import type { CashierTab } from '../cashierContracts';
import { OperationalBanner } from '../../shared/OperationalBanner';
import PromotionsSettings from '../../cardapio/PromotionsSettings';
import MenuHighlightSettings from '../../cardapio/MenuHighlightSettings';
import CartRecommendationsSettings from '../../cardapio/CartRecommendationsSettings';
import { getEffectiveProductPrice } from '../../../domain/productMerchandising';

interface CashierPromotionsHubProps {
  apiBaseUrl: string;
  authHeaders: Record<string, string>;
  produtos: Product[];
  hasCoupons?: boolean;
  hasLoyalty?: boolean;
  onNavigate?: (tab: CashierTab, subTab: string) => void;
}

export default function CashierPromotionsHub({
  apiBaseUrl,
  authHeaders,
  produtos,
  hasCoupons = false,
  hasLoyalty = false,
  onNavigate,
}: CashierPromotionsHubProps) {
  const [promotionCount, setPromotionCount] = useState<number>(0);

  const catalogVersion = useMemo(
    () => produtos.map((p) => `${p.id}:${p.nome}:${p.preco}:${p.ativo !== false ? 1 : 0}:${p.somente_promocao ? 1 : 0}`).join('|'),
    [produtos],
  );

  const highlightedCount = useMemo(
    () => produtos.filter((p) => p.destaque === true && p.ativo !== false).length,
    [produtos],
  );

  const discountedCount = useMemo(
    () => produtos.filter((p) => p.ativo !== false && getEffectiveProductPrice(p.preco, p.preco_promocional).hasDiscount).length,
    [produtos],
  );

  return (
    <div className="space-y-4">
      <OperationalBanner
        id="menu-promotions-heading"
        eyebrow="PROMOÇÕES E VITRINE"
        title="Ofertas e destaque"
        accent="em um só lugar"
        description="Configure descontos em 1 item, ofertas Compre e Ganhe com quantidade, combos com preço fechado, produto em destaque e sugestões da sacola."
        metrics={[
          { label: 'ofertas cadastradas', value: promotionCount },
          { label: 'em destaque', value: highlightedCount },
          { label: 'com preço promocional', value: discountedCount },
        ]}
      />

      <PromotionsSettings
        apiBaseUrl={apiBaseUrl}
        authHeaders={authHeaders}
        catalogVersion={catalogVersion}
        onPromotionsLoaded={setPromotionCount}
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <MenuHighlightSettings
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          products={produtos}
        />
        <CartRecommendationsSettings
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          products={produtos}
        />
      </div>

      {(hasCoupons || hasLoyalty) && onNavigate && (
        <section
          aria-labelledby="promotions-hub-benefits-title"
          className="rounded-2xl border border-koma-border bg-koma-panel p-4 sm:p-5"
        >
          <div className="flex items-start gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-koma-border bg-koma-card text-koma-foreground"
              aria-hidden="true"
            >
              <Sparkles size={18} />
            </span>
            <div className="min-w-0">
              <h2
                id="promotions-hub-benefits-title"
                className="text-base font-bold text-koma-foreground"
                style={{ fontFamily: 'var(--koma-font-display)' }}
              >
                Cupons e fidelidade
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-koma-muted">
                Gerencie códigos promocionais e regras de pontos ou cashback na área de Relacionamento.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {hasCoupons && (
              <button
                type="button"
                onClick={() => onNavigate('clientes', 'cupons')}
                className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-card px-4 py-3 text-left transition hover:bg-koma-raised"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Tag size={16} className="shrink-0 text-koma-secondary" aria-hidden="true" />
                  <span className="min-w-0">
                    <strong className="block text-sm font-semibold text-koma-foreground">Cupons de desconto</strong>
                    <span className="block text-xs text-koma-muted">Códigos públicos ou privados para o checkout</span>
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-koma-muted" aria-hidden="true" />
              </button>
            )}
            {hasLoyalty && (
              <button
                type="button"
                onClick={() => onNavigate('clientes', 'fidelidade')}
                className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-koma-border bg-koma-card px-4 py-3 text-left transition hover:bg-koma-raised"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Award size={16} className="shrink-0 text-koma-secondary" aria-hidden="true" />
                  <span className="min-w-0">
                    <strong className="block text-sm font-semibold text-koma-foreground">Programa de fidelidade</strong>
                    <span className="block text-xs text-koma-muted">Pontos, cashback e recompensas para clientes</span>
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-koma-muted" aria-hidden="true" />
              </button>
            )}
          </div>
        </section>
      )}

      {discountedCount === 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-koma-border bg-koma-panel px-4 py-3 text-xs text-koma-muted">
          <Percent size={15} className="shrink-0 text-koma-secondary" aria-hidden="true" />
          <span>
            Para dar desconto direto em um produto avulso (De / Por) ou marcar selos como Novidade e Mais pedido, edite o item em <strong className="text-koma-foreground">Cardápio → Produtos</strong>.
          </span>
        </div>
      )}
    </div>
  );
}
