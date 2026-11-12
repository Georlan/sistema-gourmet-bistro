import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, ChevronDown, ChevronUp, Minus, Plus, Search } from 'lucide-react';
import type { CatalogModifierGroup } from '../../../catalog/catalog';
import {
  canIncrementModifierQuantity,
  modifierGroupSelectionValid,
  modifierOptionQuantity,
  modifierTypeCount,
} from '../../../domain/modifierQuantity';
import { formatCurrency } from '../cashierPresentation';

interface Props {
  groups: CatalogModifierGroup[];
  selectedIds: string[];
  onQuantityChange: (group: CatalogModifierGroup, optionId: string, delta: -1 | 1) => void;
}

const normalize = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('pt-BR')
  .trim();

/**
 * POS-only presentation: domain/modifierQuantity remains the source of truth
 * for mandatory group limits, one-choice replacement and repeated portions.
 * The search state is local to the configurator, never the order cart.
 */
export function CashierPdvModifierChoices({ groups, selectedIds, onQuantityChange }: Props) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const ordered = useMemo(
    () => [...groups].sort((a, b) => Number(Number(b.min_selecoes || 0) > 0) - Number(Number(a.min_selecoes || 0) > 0)),
    [groups],
  );
  const extraGroups = ordered.filter((group) => group.recomendado === false && Number(group.min_selecoes || 0) === 0);
  const hasPrimaryGroups = ordered.some((group) => group.recomendado !== false || Number(group.min_selecoes || 0) > 0);
  const normalizedQuery = normalize(query);
  const visibleGroups = ordered.filter((group) => {
    if (normalizedQuery) {
      return normalize(group.nome).includes(normalizedQuery)
        || group.opcoes.some((option) => normalize(option.nome).includes(normalizedQuery));
    }
    return !hasPrimaryGroups || showAll || group.recomendado !== false || Number(group.min_selecoes || 0) > 0
      || group.opcoes.some((option) => selectedIds.includes(option.id));
  });
  const totalOptions = ordered.reduce((total, group) => total + group.opcoes.filter((option) => option.ativo !== false).length, 0);

  return (
    <section className="cashier-pdv-choices" aria-label="Complementos do produto">
      <div className="cashier-pdv-choices__heading">
        <h4>Complementos</h4>
        <span>{groups.length === 1 ? '1 grupo' : String(groups.length) + ' grupos'}</span>
      </div>
      {totalOptions > 6 && (
        <div className="cashier-pdv-choices__search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar complemento"
            placeholder="Buscar complemento"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {visibleGroups.length === 0 && (
        <p className="cashier-pdv-choices__empty">Nenhum complemento encontrado.</p>
      )}
      {visibleGroups.map((group) => {
        const activeOptions = group.opcoes.filter((option) => option.ativo !== false).filter((option) =>
          !normalizedQuery || normalize(group.nome).includes(normalizedQuery)
            || normalize(option.nome).includes(normalizedQuery),
        );
        if (activeOptions.length === 0) return null;
        const min = Math.max(0, Number(group.min_selecoes || 0));
        const max = Math.max(1, Number(group.max_selecoes || 1));
        const count = modifierTypeCount(group, selectedIds);
        const valid = modifierGroupSelectionValid(group, selectedIds);
        const required = min > 0;
        return (
          <section
            key={group.id}
            className="cashier-pdv-choice-group"
            data-testid="modifier-group"
            data-group-id={group.id}
            aria-label={group.nome}
          >
            <div className="cashier-pdv-choice-group__head">
              <div>
                <div className="cashier-pdv-choice-group__title">
                  <h5>{group.nome}</h5>
                  {required && <span className={clsx('cashier-pdv-choice-group__required', valid && 'is-complete')}>
                    {valid ? 'Concluído' : 'Obrigatório'}
                  </span>}
                </div>
                <p>
                  {max === 1
                    ? required ? 'Escolha 1 opção' : 'Opcional · até 1 opção'
                    : (required ? 'Escolha de ' + min + ' a ' + max : 'Até ' + max)
                      + (group.modo_selecao === 'porcoes' ? ' porções' : ' tipos diferentes')}
                </p>
              </div>
              <span className={clsx('cashier-pdv-choice-group__count', !valid && 'is-incomplete')}>
                {count}/{max}
              </span>
            </div>
            <div className="cashier-pdv-choice-group__options">
              {activeOptions.map((option) => {
                const quantity = modifierOptionQuantity(selectedIds, option.id);
                const selected = quantity > 0;
                const canAdd = canIncrementModifierQuantity(group, selectedIds, option.id);
                return (
                  <div
                    key={option.id}
                    className={clsx('cashier-pdv-choice', selected && 'is-selected')}
                    data-testid="modifier-option"
                  >
                    <button
                      type="button"
                      className="cashier-pdv-choice__select"
                      aria-pressed={selected}
                      aria-label={(selected ? 'Selecionado: ' : 'Selecionar ') + option.nome}
                      onClick={() => onQuantityChange(group, option.id, selected ? -1 : 1)}
                      disabled={!selected && !canAdd}
                    >
                      <span className="cashier-pdv-choice__check" aria-hidden="true">
                        {selected && <Check size={13} strokeWidth={3} />}
                      </span>
                      <span className="cashier-pdv-choice__text">
                        <strong>{option.nome}</strong>
                        <small>{Number(option.preco_adicional || 0) > 0
                          ? '+ ' + formatCurrency(Number(option.preco_adicional))
                          : 'Incluso'}</small>
                      </span>
                    </button>
                    {max > 1 && (
                      <div className="cashier-pdv-choice__stepper" aria-label={'Quantidade de ' + option.nome}>
                        <button
                          type="button"
                          aria-label={'Remover uma unidade de ' + option.nome}
                          disabled={quantity === 0}
                          onClick={() => onQuantityChange(group, option.id, -1)}
                        ><Minus size={16} aria-hidden="true" /></button>
                        <output aria-label={'Quantidade selecionada de ' + option.nome}>{quantity}</output>
                        <button
                          type="button"
                          aria-label={'Adicionar uma unidade de ' + option.nome}
                          disabled={!canAdd}
                          onClick={() => onQuantityChange(group, option.id, 1)}
                        ><Plus size={16} aria-hidden="true" /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {!normalizedQuery && hasPrimaryGroups && extraGroups.length > 0 && (
        <button className="cashier-pdv-choices__more" type="button" onClick={() => setShowAll((current) => !current)}>
          {showAll ? 'Mostrar apenas recomendados' : 'Ver outros complementos'}
          {showAll ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
        </button>
      )}
    </section>
  );
}
