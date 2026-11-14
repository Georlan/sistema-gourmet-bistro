import clsx from 'clsx';
import { memo } from 'react';
import { Info, ListChecks, Plus } from 'lucide-react';
import type { Product } from '../../../types';
import { formatCurrency } from '../cashierPresentation';
import { pdvProductNeedsRequiredChoices } from './pdvProductChoices';

interface CashierPdvProductCardProps {
  product: Product;
  cartQuantity?: number;
  detailsOpen: boolean;
  recentlyAdded?: boolean;
  onConfigure: (product: Product) => void;
  onQuickAdd: (product: Product) => void;
  onToggleDetails: (productId: string) => void;
}

const splitProductLabel = (label: string) => {
  const match = String(label || '').match(/^(\d{2,4})\s*[-–]\s*(.+)$/);
  return match ? { code: match[1], name: match[2] } : { code: '', name: label };
};

/**
 * A single product's visual presentation. It does not own selection, prices,
 * cart mutations or availability: the canonical PDV hook remains authoritative.
 * Three independent buttons avoid nesting interactive controls in a fake button.
 */
function CashierPdvProductCardView({
  product,
  cartQuantity = 0,
  detailsOpen,
  recentlyAdded = false,
  onConfigure,
  onQuickAdd,
  onToggleDetails,
}: CashierPdvProductCardProps) {
  const { code, name } = splitProductLabel(product.nome);
  const hasDetails = Boolean(product.descricao || code);
  const needsChoices = pdvProductNeedsRequiredChoices(product);
  const productId = String(product.id);
  const detailsId = `pdv-product-details-${productId}`;

  return (
    <article className={clsx("cashier-pdv-product-card group", cartQuantity > 0 && "is-in-cart", recentlyAdded && "is-just-added")} data-testid="cashier-pdv-product-card">
      <button
        type="button"
        className="cashier-pdv-product-card__open"
        aria-label={`Personalizar ${name}`}
        title={`Personalizar ${name} e escolher complementos`}
        onClick={() => onConfigure(product)}
      />
      <div className="cashier-pdv-product-card__content">
        {product.imagem && (
          <img
            className="cashier-pdv-product-card__image"
            src={product.imagem}
            alt=""
            width={256}
            height={104}
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="cashier-pdv-product-card__identity">
          <div className="cashier-pdv-product-card__heading">
            <h4 className="cashier-pdv-product-card__name">{name}</h4>
            {cartQuantity > 0 && (
              <span className="cashier-pdv-product-card__quantity" aria-label={`${cartQuantity} ${cartQuantity === 1 ? 'unidade' : 'unidades'} no pedido`}>
                {cartQuantity > 99 ? '99+' : cartQuantity}
              </span>
            )}
          </div>
        </div>
        <div className="cashier-pdv-product-actions">
          <span className="cashier-pdv-product-card__price">{formatCurrency(Number(product.preco) || 0)}</span>
          <button
            type="button"
            className="cashier-pdv-product-card__add"
            onClick={() => onQuickAdd(product)}
            aria-label={needsChoices ? `Escolher opções de ${name}` : `Adicionar ${name} rapidamente`}
            title={needsChoices ? 'Escolha os complementos obrigatórios antes de adicionar' : 'Adicionar uma unidade sem alterações'}
          >
            {needsChoices ? <ListChecks size={16} strokeWidth={2.3} aria-hidden="true" /> : <Plus size={16} strokeWidth={2.3} aria-hidden="true" />}
            <span>{needsChoices ? 'Escolher opções' : 'Adicionar'}</span>
          </button>
        </div>
      </div>
      {hasDetails && (
        <>
          <button
            type="button"
            className="cashier-pdv-product-card__info"
            aria-label={`Ver ingredientes e detalhes de ${name}`}
            title="Ver ingredientes e detalhes"
            aria-expanded={detailsOpen}
            aria-controls={detailsId}
            onClick={() => onToggleDetails(productId)}
          >
            <Info size={17} aria-hidden="true" />
          </button>
          <div
            id={detailsId}
            role="note"
            aria-hidden={!detailsOpen}
            className={clsx('cashier-pdv-product-card__details', detailsOpen && 'is-open')}
          >
            <strong>Ingredientes e detalhes</strong>
            {code && <span>Cód. {code}</span>}
            <p>{product.descricao || 'Sem descrição cadastrada.'}</p>
          </div>
        </>
      )}
    </article>
  );
}

// Keep a large catalogue stable when the cart changes: with stable handlers,
// only the updated card, its quantity and the current detail panel rerender.
export const CashierPdvProductCard = memo(CashierPdvProductCardView);
