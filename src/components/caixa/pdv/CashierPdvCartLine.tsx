import { ChevronDown, Edit3, Minus, Plus, Trash2 } from 'lucide-react';
import { getProductPresets } from '../../../domain/catalogPresentation';
import { formatCurrency } from '../cashierPresentation';
import { pdvCartItemUnitPrice, type PdvCartItem, type PdvModifierSelection } from './useCashierPdv';

interface CashierPdvCartLineProps {
  item: PdvCartItem;
  index: number;
  availability: { unavailable: boolean; reason?: string };
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onChangeQuantity: (index: number, delta: -1 | 1) => void;
  onChangeObservation: (index: number, value: string) => void;
}

function summarizeModifiers(modifiers: PdvModifierSelection[]) {
  const summary = new Map<string, { name: string; quantity: number }>();
  for (const modifier of modifiers) {
    const previous = summary.get(modifier.id);
    if (previous) previous.quantity += 1;
    else summary.set(modifier.id, { name: modifier.nome, quantity: 1 });
  }
  return Array.from(summary.values());
}

function togglePreset(observation: string, preset: string): string {
  const parts = observation.split(',').map((part) => part.trim()).filter(Boolean);
  const included = parts.some((part) => part.toLowerCase() === preset.toLowerCase());
  return (included
    ? parts.filter((part) => part.toLowerCase() !== preset.toLowerCase())
    : [...parts, preset]).join(', ');
}

/**
 * Presentation only: prices, quantities and modifiers come from the canonical
 * cart owner. Native details keeps optional preparation notes off the primary
 * scanning path without adding any React state or API requests.
 */
export function CashierPdvCartLine({
  item, index, availability, onEdit, onRemove, onChangeQuantity, onChangeObservation,
}: CashierPdvCartLineProps) {
  const presets = getProductPresets(item.product);
  const selectedPresets = item.obs.split(',').map((part) => part.trim().toLowerCase());
  const unitPrice = pdvCartItemUnitPrice(item);
  const modifiers = summarizeModifiers(item.modifiers || []);

  return (
    <article className="cashier-pdv-cart__line" data-testid="cashier-pdv-cart-line">
      <div className="cashier-pdv-cart__line-heading">
        <div className="cashier-pdv-cart__line-name">
          <strong>{item.product.nome}</strong>
          <span className="cashier-pdv-cart__unit-price">{formatCurrency(unitPrice)} / un.</span>
        </div>
        <div className="cashier-pdv-cart__line-tools">
          <button
            type="button"
            aria-label={`Editar ${item.product.nome}`}
            title="Personalizar produto"
            onClick={() => onEdit(index)}
            className="cashier-pdv-cart__item-action"
          >
            <Edit3 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Remover ${item.product.nome}`}
            title="Remover item"
            onClick={() => onRemove(index)}
            className="cashier-pdv-cart__item-action cashier-pdv-cart__item-action--danger"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      {availability.unavailable && (
        <p
          id={`pdv-cart-item-unavailable-${index}`}
          data-testid={`pdv-cart-item-unavailable-${index}`}
          className="cashier-pdv-cart__unavailable"
        >
          {availability.reason === 'paused' ? 'Produto pausado' : 'Indisponível no cardápio ativo'}
        </p>
      )}
      {modifiers.length > 0 && (
        <p className="cashier-pdv-cart__modifiers">
          {modifiers.map(({ name, quantity }) => `${quantity > 1 ? `${quantity}× ` : ''}${name}`).join(' · ')}
        </p>
      )}
      <div className="cashier-pdv-cart__line-bottom">
        <div className="cashier-pdv-cart__quantity" aria-label={`Quantidade de ${item.product.nome}`}>
          <button
            type="button"
            onClick={() => onChangeQuantity(index, -1)}
            className="cashier-pdv-cart__qty-button"
            aria-label={`Diminuir quantidade de ${item.product.nome}`}
          >
            <Minus size={16} aria-hidden="true" />
          </button>
          <span className="cashier-pdv-cart__qty-value">{item.quantity}</span>
          <button
            type="button"
            onClick={() => onChangeQuantity(index, 1)}
            className="cashier-pdv-cart__qty-button"
            aria-label={`Aumentar quantidade de ${item.product.nome}`}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <strong className="cashier-pdv-cart__line-total">{formatCurrency(unitPrice * item.quantity)}</strong>
      </div>
      <details className="cashier-pdv-cart__notes">
        <summary>
          <span>{item.obs ? `Preparo: ${item.obs}` : 'Observações e preparo'}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <div className="cashier-pdv-cart__notes-content">
          <input
            type="text"
            aria-label={`Observação de ${item.product.nome}`}
            placeholder="Ex.: sem queijo, para viagem..."
            value={item.obs}
            onChange={(event) => onChangeObservation(index, event.target.value)}
            className="cashier-pdv-cart__observation"
          />
          {presets.length > 0 && (
            <div className="cashier-pdv-cart__presets" aria-label="Instruções rápidas de preparo">
              {presets.map((preset) => {
                const pressed = selectedPresets.includes(preset.toLowerCase());
                return (
                  <button
                    key={preset}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => onChangeObservation(index, togglePreset(item.obs, preset))}
                    className="cashier-pdv-cart__preset"
                  >
                    {pressed ? preset : `+${preset}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </details>
    </article>
  );
}
