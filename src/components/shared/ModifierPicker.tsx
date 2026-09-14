import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Minus, Plus, Search } from 'lucide-react';

import type { CatalogModifierGroup } from '../../catalog/catalog';
import {
  canIncrementModifierQuantity,
  modifierGroupSelectionValid,
  modifierOptionQuantity,
  modifierTypeCount,
} from '../../domain/modifierQuantity';

type Props = {
  groups: CatalogModifierGroup[];
  selectedIds: string[];
  onToggle?: (group: CatalogModifierGroup, optionId: string) => void;
  onQuantityChange?: (group: CatalogModifierGroup, optionId: string, delta: -1 | 1) => void;
  compact?: boolean;
};

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();

export default function ModifierPicker({
  groups,
  selectedIds,
  onToggle,
  onQuantityChange,
  compact = false,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');

  const mandatoryOrRecommended = useMemo(
    () => groups.filter((group) => group.recomendado !== false || Number(group.min_selecoes || 0) > 0 || group.tipo === 'obrigatorio'),
    [groups],
  );
  const additionalGroups = useMemo(
    () => groups.filter((group) => !mandatoryOrRecommended.some((recommended) => recommended.id === group.id)),
    [groups, mandatoryOrRecommended],
  );

  const normalizedQuery = normalize(query);
  const visibleGroups = useMemo(() => {
    if (normalizedQuery) {
      return groups.filter((group) => {
        if (normalize(group.nome).includes(normalizedQuery)) return true;
        return group.opcoes.some((option) => normalize(option.nome).includes(normalizedQuery));
      });
    }
    if (showAll || mandatoryOrRecommended.length === 0) return groups;
    return mandatoryOrRecommended;
  }, [groups, mandatoryOrRecommended, normalizedQuery, showAll]);

  if (groups.length === 0) {
    return <p className="text-[10px] text-koma-muted">Nenhum adicional disponível neste restaurante.</p>;
  }

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3'}>
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-koma-subtle" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar adicional..."
          className="w-full rounded-xl border border-koma-border bg-koma-input py-2 pl-8 pr-3 text-[11px] text-koma-foreground outline-none focus:border-emerald-500"
        />
      </div>

      {!normalizedQuery && additionalGroups.length > 0 && mandatoryOrRecommended.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="flex w-full items-center justify-between rounded-xl border border-koma-border bg-koma-raised px-3 py-2 text-left text-[10px] font-semibold text-koma-muted hover:text-koma-foreground"
        >
          <span>{showAll ? 'Mostrar somente recomendados' : `Ver todos os adicionais (+${additionalGroups.length} grupos)`}</span>
          {showAll ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      )}

      {visibleGroups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-koma-border px-3 py-5 text-center text-[10px] text-koma-muted">
          Nenhum adicional encontrado para “{query}”.
        </p>
      ) : (
        visibleGroups.map((group) => {
          const activeOptions = group.opcoes.filter((option) => option.ativo !== false).filter((option) => {
            if (!normalizedQuery) return true;
            return normalize(group.nome).includes(normalizedQuery) || normalize(option.nome).includes(normalizedQuery);
          });
          if (activeOptions.length === 0) return null;

          const selectedCount = modifierTypeCount(group, selectedIds);
          const min = Number(group.min_selecoes || 0);
          const max = Math.max(1, Number(group.max_selecoes || 1));
          const valid = modifierGroupSelectionValid(group, selectedIds);
          const recommended = group.recomendado !== false || min > 0 || group.tipo === 'obrigatorio';
          const quantityMode = Boolean(onQuantityChange);

          return (
            <div
              key={group.id}
              className={`rounded-xl border p-3 ${valid ? 'border-koma-border bg-koma-raised/40' : 'border-amber-500/40 bg-amber-500/5'}`}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-bold text-koma-foreground">{group.nome}</span>
                    {recommended && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-emerald-400">
                        Recomendado
                      </span>
                    )}
                  </div>
                  <span className="block text-[9px] text-koma-muted">
                    {quantityMode
                      ? max === 1
                        ? 'Escolha uma opção'
                        : min > 0
                          ? `Escolha de ${min} a ${max} tipos · quantidade livre por adicional`
                          : `Até ${max} tipos · quantidade livre por adicional`
                      : min > 0
                        ? `Escolha de ${min} a ${max}`
                        : `Escolha até ${max}`}
                  </span>
                </div>
                <span className={`text-[9px] font-bold ${valid ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {quantityMode && max > 1 ? `${selectedCount}/${max} tipos` : `${selectedCount}/${max}`}
                </span>
              </div>

              <div className="space-y-1.5">
                {activeOptions.map((option) => {
                  const optionQuantity = modifierOptionQuantity(selectedIds, option.id);
                  const selected = optionQuantity > 0;
                  const canIncrement = canIncrementModifierQuantity(group, selectedIds, option.id);

                  if (onQuantityChange) {
                    return (
                      <div
                        key={option.id}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 transition ${selected ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-koma-border bg-koma-card'}`}
                      >
                        <div className="min-w-0">
                          <span className="block truncate text-xs font-medium text-koma-foreground">{option.nome}</span>
                          <span className="font-mono text-[10px] font-bold text-emerald-400">
                            {Number(option.preco_adicional || 0) > 0 ? `+ R$ ${Number(option.preco_adicional).toFixed(2)} cada` : 'Grátis'}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-koma-border bg-koma-raised p-0.5">
                          <button
                            type="button"
                            onClick={() => onQuantityChange(group, option.id, -1)}
                            disabled={optionQuantity <= 0}
                            className="grid h-7 w-7 place-items-center rounded-md text-koma-muted transition hover:bg-koma-card hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={`Remover uma unidade de ${option.nome}`}
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-6 text-center font-mono text-xs font-bold text-koma-foreground" aria-label={`${optionQuantity} unidade(s) de ${option.nome}`}>
                            {optionQuantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => onQuantityChange(group, option.id, 1)}
                            disabled={!canIncrement}
                            className="grid h-7 w-7 place-items-center rounded-md text-koma-muted transition hover:bg-koma-card hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label={`Adicionar uma unidade de ${option.nome}`}
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onToggle?.(group, option.id)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition ${selected ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-koma-border bg-koma-card hover:border-emerald-500/25'}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-emerald-500 bg-emerald-500 text-black' : 'border-koma-border'}`}>
                          {selected && <Check size={11} strokeWidth={3} />}
                        </span>
                        <span className="truncate text-xs font-medium text-koma-foreground">{option.nome}</span>
                      </span>
                      <span className="whitespace-nowrap font-mono text-[11px] font-bold text-emerald-400">
                        {Number(option.preco_adicional || 0) > 0 ? `+ R$ ${Number(option.preco_adicional).toFixed(2)}` : 'Grátis'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
