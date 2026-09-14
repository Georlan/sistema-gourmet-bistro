import type { CatalogModifierGroup } from '../catalog/catalog';

export type ModifierQuantityRules = {
  optionIds: readonly string[];
  minSelection?: number;
  maxSelection?: number;
};

const normalizedRules = (rules: ModifierQuantityRules) => ({
  optionIds: new Set(rules.optionIds),
  min: Math.max(0, Number(rules.minSelection || 0)),
  max: Math.max(1, Number(rules.maxSelection || 1)),
});

export const selectionTypeCount = (
  rules: ModifierQuantityRules,
  selectedIds: readonly string[],
) => {
  const { optionIds } = normalizedRules(rules);
  return new Set(selectedIds.filter((id) => optionIds.has(id))).size;
};

export const modifierOptionQuantity = (selectedIds: readonly string[], optionId: string) =>
  selectedIds.filter((id) => id === optionId).length;

export const selectionWithinRules = (
  rules: ModifierQuantityRules,
  selectedIds: readonly string[],
) => {
  const { min, max } = normalizedRules(rules);
  const selectedTypes = selectionTypeCount(rules, selectedIds);
  return selectedTypes >= min && selectedTypes <= max;
};

export const canIncrementSelectionQuantity = (
  rules: ModifierQuantityRules,
  selectedIds: readonly string[],
  optionId: string,
) => {
  const { optionIds, max } = normalizedRules(rules);
  if (!optionIds.has(optionId)) return false;

  const currentQuantity = modifierOptionQuantity(selectedIds, optionId);

  // Escolha única continua exclusiva. Para grupos com múltiplos tipos,
  // repetir o mesmo adicional não consome uma nova vaga do grupo.
  if (max === 1) return currentQuantity === 0;
  if (currentQuantity > 0) return true;

  return selectionTypeCount(rules, selectedIds) < max;
};

export const changeSelectionQuantity = (
  rules: ModifierQuantityRules,
  selectedIds: readonly string[],
  optionId: string,
  delta: -1 | 1,
): string[] => {
  const current = [...selectedIds];
  const { optionIds, max } = normalizedRules(rules);
  if (!optionIds.has(optionId)) return current;

  if (delta < 0) {
    const removeIndex = current.lastIndexOf(optionId);
    if (removeIndex < 0) return current;
    return current.filter((_, index) => index !== removeIndex);
  }

  const currentQuantity = modifierOptionQuantity(current, optionId);

  if (max === 1) {
    if (currentQuantity > 0) return current;
    return [...current.filter((id) => !optionIds.has(id)), optionId];
  }

  if (currentQuantity === 0 && selectionTypeCount(rules, current) >= max) return current;
  return [...current, optionId];
};

const activeOptionIds = (group: CatalogModifierGroup) =>
  group.opcoes.filter((option) => option.ativo !== false).map((option) => option.id);

const catalogRules = (group: CatalogModifierGroup): ModifierQuantityRules => ({
  optionIds: activeOptionIds(group),
  minSelection: Number(group.min_selecoes || 0),
  maxSelection: Number(group.max_selecoes || 1),
});

export const modifierTypeCount = (group: CatalogModifierGroup, selectedIds: readonly string[]) =>
  selectionTypeCount(catalogRules(group), selectedIds);

export const modifierGroupSelectionValid = (
  group: CatalogModifierGroup,
  selectedIds: readonly string[],
) => selectionWithinRules(catalogRules(group), selectedIds);

export const canIncrementModifierQuantity = (
  group: CatalogModifierGroup,
  selectedIds: readonly string[],
  optionId: string,
) => canIncrementSelectionQuantity(catalogRules(group), selectedIds, optionId);

export const changeModifierQuantitySelection = (
  group: CatalogModifierGroup,
  selectedIds: readonly string[],
  optionId: string,
  delta: -1 | 1,
): string[] => changeSelectionQuantity(catalogRules(group), selectedIds, optionId, delta);
