import type { CatalogModifierGroup } from '../catalog/catalog';

const activeOptionIds = (group: CatalogModifierGroup) =>
  new Set(group.opcoes.filter((option) => option.ativo !== false).map((option) => option.id));

export const modifierTypeCount = (group: CatalogModifierGroup, selectedIds: readonly string[]) => {
  const optionIds = activeOptionIds(group);
  return new Set(selectedIds.filter((id) => optionIds.has(id))).size;
};

export const modifierOptionQuantity = (selectedIds: readonly string[], optionId: string) =>
  selectedIds.filter((id) => id === optionId).length;

export const modifierGroupSelectionValid = (
  group: CatalogModifierGroup,
  selectedIds: readonly string[],
) => {
  const selectedTypes = modifierTypeCount(group, selectedIds);
  const min = Number(group.min_selecoes || 0);
  const max = Math.max(1, Number(group.max_selecoes || 1));
  return selectedTypes >= min && selectedTypes <= max;
};

export const canIncrementModifierQuantity = (
  group: CatalogModifierGroup,
  selectedIds: readonly string[],
  optionId: string,
) => {
  const optionIds = activeOptionIds(group);
  if (!optionIds.has(optionId)) return false;

  const max = Math.max(1, Number(group.max_selecoes || 1));
  const currentQuantity = modifierOptionQuantity(selectedIds, optionId);

  // Grupos de escolha única continuam exclusivos (ex.: tamanho/ponto).
  if (max === 1) return currentQuantity === 0;

  // Depois que um tipo foi escolhido, sua quantidade não consome novas vagas do grupo.
  if (currentQuantity > 0) return true;

  return modifierTypeCount(group, selectedIds) < max;
};

export const changeModifierQuantitySelection = (
  group: CatalogModifierGroup,
  selectedIds: readonly string[],
  optionId: string,
  delta: -1 | 1,
): string[] => {
  const current = [...selectedIds];
  const optionIds = activeOptionIds(group);
  if (!optionIds.has(optionId)) return current;

  if (delta < 0) {
    const removeIndex = current.lastIndexOf(optionId);
    if (removeIndex < 0) return current;
    return current.filter((_, index) => index !== removeIndex);
  }

  const max = Math.max(1, Number(group.max_selecoes || 1));
  const currentQuantity = modifierOptionQuantity(current, optionId);

  if (max === 1) {
    if (currentQuantity > 0) return current;
    return [...current.filter((id) => !optionIds.has(id)), optionId];
  }

  if (currentQuantity === 0 && modifierTypeCount(group, current) >= max) return current;
  return [...current, optionId];
};
