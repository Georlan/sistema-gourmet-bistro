import clsx from 'clsx';
import { Info, Plus } from 'lucide-react';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import type { Product } from '../../../types';
import { formatCurrency } from '../cashierPresentation';

type ProductWithModifiers = Product & { grupos_modificadores?: CatalogModifierGroup[] };

interface CashierPdvProductCardProps {
  product: Product;
  detailsOpen: boolean;
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
export function CashierPdvProductCard({
  product,
  detailsOpen,
  onConfigure,
  onQuickAdd,
  onToggleDetails,
}: CashierPdvProductCardProps) {
  const { code, name } = splitProductLabel(product.nome);
  const hasDetails = Boolean(product.descricao || code);
  const hasChoices = Boolean((product as ProductWithModifiers).grupos_modificadores?.length);
  const productId = String(product.id);
  const detailsId = `pdv-product-details-${productId}`;

  return (
    <article className="cashier-pdv-product-card group" data-testid="cashier-pdv-product-card">
      <button
        type="button"
        className="cashier-pdv-product-card__open"
        aria-label={`Personalizar ${name}`}
        title={`Personalizar ${name}`}
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
          <h4 className="cashier-pdv-product-card__name">{name}</h4>
          {hasChoices && (
            <span className="cashier-pdv-product-card__choices">Personalizável</span>
          )}
        </div>
        <div className="cashier-pdv-product-actions">
          <span className="cashier-pdv-product-card__price">{formatCurrency(Number(product.preco) || 0)}</span>
          <button
            type="button"
            className="cashier-pdv-product-card__add"
            onClick={() => onQuickAdd(product)}
            aria-label={`Adicionar ${name} rapidamente`}
          >
            <Plus size={16} strokeWidth={2.3} aria-hidden="true" />
            <span>Adicionar</span>
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
