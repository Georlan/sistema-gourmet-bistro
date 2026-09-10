import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Search } from 'lucide-react';

import type { CatalogModifierGroup } from '../../catalog/catalog';

type Props = {
  groups: CatalogModifierGroup[];
  selectedIds: string[];
  onToggle: (group: CatalogModifierGroup, optionId: string) => void;
  compact?: boolean;
};

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();

export default function ModifierPicker({ groups, selectedIds, onToggle, compact = false }: Props) {
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

          const optionIds = new Set(group.opcoes.filter((option) => option.ativo !== false).map((option) => option.id));
          const selectedCount = selectedIds.filter((id) => optionIds.has(id)).length;
          const min = Number(group.min_selecoes || 0);
          const max = Math.max(1, Number(group.max_selecoes || 1));
          const valid = selectedCount >= min && selectedCount <= max;
          const recommended = group.recomendado !== false || min > 0 || group.tipo === 'obrigatorio';

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
                    {min > 0 ? `Escolha de ${min} a ${max}` : `Escolha até ${max}`}
                  </span>
                </div>
                <span className={`text-[9px] font-bold ${valid ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {selectedCount}/{max}
                </span>
              </div>

              <div className="space-y-1.5">
                {activeOptions.map((option) => {
                  const selected = selectedIds.includes(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onToggle(group, option.id)}
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