import type { CartItem } from './components/CardapioCartDrawer';

type PublicOption = { id?: unknown; ativo?: boolean; preco_adicional?: unknown };
type PublicGroup = { id?: unknown; opcoes?: PublicOption[] };
type PublicProduct = {
  id?: unknown;
  ativo?: boolean;
  preco?: unknown;
  grupos_modificadores?: PublicGroup[];
};

/**
 * Public catalogue snapshots are authoritative for the available composition.
 * Never silently remove a customer choice: ask them to review the affected item.
 * The backend still validates all products, tenants, rules, and prices at write time.
 */
export function findOutdatedCartProducts(cart: readonly CartItem[], snapshot: unknown): string[] {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Resposta inválida do cardápio.');
  }
  const data = snapshot as { produtos?: unknown; produtos_promocionais?: unknown };
  if (!Array.isArray(data.produtos)) {
    throw new Error('Resposta inválida do cardápio.');
  }
  const products = [...data.produtos, ...(Array.isArray(data.produtos_promocionais) ? data.produtos_promocionais : [])] as PublicProduct[];
  const byId = new Map(products.map(product => [String(product.id), product]));
  const outdated = new Set<string>();
  const money = (value: unknown) => Math.round(Number(value) * 100);

  const checkItem = (
    productId: string,
    productName: string,
    originalPrice: number,
    selected: CartItem['selectedOptions'],
  ) => {
    const fresh = byId.get(productId);
    if (!fresh || fresh.ativo === false || !Number.isFinite(Number(fresh.preco)) || money(fresh.preco) !== money(originalPrice)) {
      outdated.add(productName);
      return;
    }
    for (const [groupId, choices] of Object.entries(selected)) {
      if (!choices.length) continue;
      const group = fresh.grupos_modificadores?.find(g => String(g.id) === groupId);
      if (!group || !Array.isArray(group.opcoes) || choices.some(choice => {
        const option = group.opcoes!.find(o => String(o.id) === choice.id);
        return !option || option.ativo === false || money(option.preco_adicional ?? 0) !== money(choice.extraPrice);
      })) {
        outdated.add(productName);
        return;
      }
    }
  };

  for (const item of cart) {
    if (item.promotionParts) {
      for (const part of item.promotionParts) {
        checkItem(part.product.id, part.product.name, part.product.price, part.selectedOptions);
      }
    } else {
      checkItem(item.product.id, item.product.name, item.product.price, item.selectedOptions);
    }
  }
  return [...outdated];
}
