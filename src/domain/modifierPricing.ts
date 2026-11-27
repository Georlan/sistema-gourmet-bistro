export type MeioAMeioPricingRule = 'maior_preco' | 'media' | 'soma';

export function normalizeMeioAMeioPricingRule(value: unknown): MeioAMeioPricingRule {
  if (value === 'media' || value === 'soma' || value === 'maior_preco') {
    return value;
  }
  return 'maior_preco';
}

export function meioAMeioPricingRuleLabel(rule: unknown): string {
  const normalized = normalizeMeioAMeioPricingRule(rule);
  if (normalized === 'media') return 'Média proporcional dos sabores';
  if (normalized === 'soma') return 'Soma dos sabores';
  return 'Maior valor entre os sabores';
}

function toCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100);
}

/**
 * Mirrors backend `resolve_modifiers_pricing` so Cardápio, PDV, Waiter and Cart
 * show the exact unit price computed by `OrderPricingService.calculate_quote`.
 */
export function calculateModifierGroupSurcharge(
  prices: readonly number[],
  groupType: string | undefined,
  pricingRule?: string | null,
): number {
  const cents = prices.map((price) => toCents(Number(price || 0)));
  if (cents.length === 0) return 0;

  if (groupType !== 'meio_a_meio' || cents.length <= 1) {
    return cents.reduce((sum, item) => sum + item, 0) / 100;
  }

  const rule = normalizeMeioAMeioPricingRule(pricingRule);
  if (rule === 'soma') {
    return cents.reduce((sum, item) => sum + item, 0) / 100;
  }
  if (rule === 'maior_preco') {
    return Math.max(...cents) / 100;
  }
  const total = cents.reduce((sum, item) => sum + item, 0);
  return Math.round(total / cents.length) / 100;
}

export type ModifierGroupPricingMeta = {
  id: string;
  type?: string;
  tipo?: string;
  meioAMeioPricingRule?: MeioAMeioPricingRule;
  regra_preco_meio_a_meio?: MeioAMeioPricingRule | string;
};

/**
 * Computes total surcharge across a Record<groupId, selections> using group
 * pricing metadata when present (handling `meio_a_meio` rules uniformly).
 */
export function calculateSelectedOptionsSurcharge(
  selectedOptions: Record<string, ReadonlyArray<{ extraPrice?: number; preco?: number; preco_adicional?: number }>> | undefined,
  groups: ReadonlyArray<ModifierGroupPricingMeta> | undefined,
): number {
  if (!selectedOptions) return 0;
  const groupsById = new Map((groups || []).map((group) => [String(group.id), group]));
  let totalCents = 0;

  for (const [groupId, selections] of Object.entries(selectedOptions)) {
    if (!selections || selections.length === 0) continue;
    const group = groupsById.get(String(groupId));
    const groupType = group?.type || group?.tipo;
    const rule = group?.meioAMeioPricingRule ?? group?.regra_preco_meio_a_meio;
    const prices = selections.map((option) => Number(option.extraPrice ?? option.preco ?? option.preco_adicional ?? 0));
    totalCents += toCents(calculateModifierGroupSurcharge(prices, groupType, rule));
  }

  return totalCents / 100;
}

export type CatalogPricingGroup = {
  id: string;
  tipo?: string;
  regra_preco_meio_a_meio?: string;
  opcoes: ReadonlyArray<{ id: string; preco_adicional?: number; ativo?: boolean }>;
};

/**
 * Computes total surcharge for flat `selectedModifierIds` arrays used in Cashier PDV and Waiter flows.
 */
export function calculateCatalogModifierIdsSurcharge(
  groups: readonly CatalogPricingGroup[],
  selectedIds: readonly string[],
): number {
  if (!selectedIds.length || !groups.length) return 0;
  const pricesByGroup = new Map<string, number[]>();
  const optionLookup = new Map<string, { groupId: string; price: number }>();

  for (const group of groups) {
    for (const option of group.opcoes) {
      if (option.ativo === false) continue;
      optionLookup.set(String(option.id), {
        groupId: String(group.id),
        price: Number(option.preco_adicional || 0),
      });
    }
  }

  for (const id of selectedIds) {
    const match = optionLookup.get(String(id));
    if (!match) continue;
    const list = pricesByGroup.get(match.groupId) || [];
    list.push(match.price);
    pricesByGroup.set(match.groupId, list);
  }

  const groupsById = new Map(groups.map((group) => [String(group.id), group]));
  let totalCents = 0;
  for (const [groupId, prices] of pricesByGroup.entries()) {
    const group = groupsById.get(groupId);
    totalCents += toCents(
      calculateModifierGroupSurcharge(prices, group?.tipo, group?.regra_preco_meio_a_meio),
    );
  }
  return totalCents / 100;
}
