import type { CatalogModifierGroup } from '../../../catalog/catalog';
import { modifierGroupSelectionValid } from '../../../domain/modifierQuantity';
import type { Product } from '../../../types';

type PdvProductWithGroups = Product & { grupos_modificadores?: CatalogModifierGroup[] };

/**
 * A quick add is valid only when the product can be sold without choices.
 * Reuse the canonical min/max and selection-mode rules. Optional modifiers
 * stay optional; required groups cannot be bypassed by an inexperienced
 * operator and rejected later at submission.
 */
export function pdvProductNeedsRequiredChoices(product: Product): boolean {
  const groups = (product as PdvProductWithGroups).grupos_modificadores;
  return Array.isArray(groups)
    && groups.some((group) => !modifierGroupSelectionValid(group, []));
}
