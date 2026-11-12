import { useEffect, useRef } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import type { Product } from '../../../types';
import { formatCurrency } from '../cashierPresentation';
import { CashierPdvModifierChoices } from './CashierPdvModifierChoices';

interface Props {
  product: Product;
  isEditing: boolean;
  quantity: number;
  onQuantityChange: (next: number) => void;
  observation: string;
  onObservationChange: (next: string) => void;
  groups: CatalogModifierGroup[];
  selectedIds: string[];
  onModifierChange: (group: CatalogModifierGroup, optionId: string, delta: -1 | 1) => void;
  total: number;
  valid: boolean;
  onSave: () => void;
  onClose: () => void;
}

/**
 * Mobile-first bottom sheet / centered desktop dialog.
 * Only presentation state lives here; all configured item values and pricing
 * are owned by CashierPdvView and its canonical modifierQuantity domain.
 */
export function CashierPdvConfigurator({
  product, isEditing, quantity, onQuantityChange, observation, onObservationChange,
  groups, selectedIds, onModifierChange, total, valid, onSave, onClose,
}: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const candidates = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (candidates.length === 0) return;
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="cashier-pdv-config-overlay"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="presentation"
    >
      <section
        className="cashier-pdv-config"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdv-config-title"
        aria-describedby="pdv-config-description"
        data-testid="cashier-pdv-config-dialog"
      >
        <div className="cashier-pdv-config__grip" aria-hidden="true" />
        <header className="cashier-pdv-config__header">
          <div className="cashier-pdv-config__product">
            {product.imagem && (
              <img src={product.imagem} alt="" width={74} height={74} decoding="async" />
            )}
            <div className="cashier-pdv-config__identity">
              <span className="cashier-pdv-config__eyebrow">
                {isEditing ? 'Editar item' : 'Personalizar item'}
              </span>
              <h3 id="pdv-config-title">{product.nome}</h3>
              <strong>{formatCurrency(Number(product.preco || 0))}</strong>
            </div>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Fechar personalização"
            className="cashier-pdv-config__close"
          ><X size={20} aria-hidden="true" /></button>
        </header>

        <div className="cashier-pdv-config__scroll">
          {product.descricao && (
            <p id="pdv-config-description" className="cashier-pdv-config__description">
              {product.descricao}
            </p>
          )}
          {!product.descricao && <span id="pdv-config-description" className="sr-only">Configure a quantidade e os complementos do produto.</span>}
          <div className="cashier-pdv-config__quantity-row">
            <div>
              <span className="cashier-pdv-config__field-name">Quantidade</span>
              <small>Unidades deste item</small>
            </div>
            <div className="cashier-pdv-config__stepper" aria-label="Quantidade de itens">
              <button
                type="button"
                aria-label="Diminuir quantidade"
                onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
                disabled={quantity <= 1}
              ><Minus size={18} aria-hidden="true" /></button>
              <output aria-label="Quantidade configurada">{quantity}</output>
              <button
                type="button"
                aria-label="Aumentar quantidade"
                onClick={() => onQuantityChange(quantity + 1)}
              ><Plus size={18} aria-hidden="true" /></button>
            </div>
          </div>

          {groups.length > 0 && (
            <CashierPdvModifierChoices
              groups={groups}
              selectedIds={selectedIds}
              onQuantityChange={onModifierChange}
            />
          )}

          <div className="cashier-pdv-config__notes">
            <label htmlFor="pdv-config-obs">Observações <span>(opcional)</span></label>
            <input
              id="pdv-config-obs"
              type="text"
              value={observation}
              onChange={(event) => onObservationChange(event.target.value)}
              placeholder="Ex.: sem cebola, molho à parte..."
              autoComplete="off"
            />
          </div>
        </div>

        <footer className="cashier-pdv-config__footer">
          <div className="cashier-pdv-config__total">
            <span>Total do item</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          {!valid && <p className="cashier-pdv-config__validation" role="status">Complete as escolhas obrigatórias para continuar.</p>}
          <button
            type="button"
            className="cashier-pdv-config__save"
            onClick={onSave}
            disabled={!valid}
          >
            <Check size={19} aria-hidden="true" />
            {isEditing ? 'Salvar alterações' : 'Adicionar ao pedido'}
          </button>
        </footer>
      </section>
    </div>
  );
}
