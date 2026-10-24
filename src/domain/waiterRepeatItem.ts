import type { CatalogModifierGroup } from '../catalog/catalog';
import type { DraftItem, OrderItem, Product } from '../types';
import { modifierGroupSelectionValid } from './modifierQuantity';

export type RepeatConfiguration = {
  productId: string;
  observacao: string;
  clienteNome: string;
  modifierIds: string[];
};
type RepeatedProduct = Product & {
  __selectedModifierIds: string[];
  __selectedModifiers: { id: string; nome: string; preco: number }[];
  __selectedModifierTotal: number;
};
type RepeatPlan =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'configure'; configuration: RepeatConfiguration }
  | { kind: 'quick'; product: RepeatedProduct; client: string; observation: string; unitPrice: number };

/** Rebuild a NEW unit from the current catalog. Historical consumption is never repriced. */
export function planWaiterRepeat(item: OrderItem, product?: Product): RepeatPlan {
  if (!product || product.ativo === false || !Number.isFinite(Number(product.preco)) || Number(product.preco) < 0) {
    return { kind: 'unavailable', reason: 'Produto indisponível' };
  }
  if (item.composicao_agrupada || item.status === 'cancelado') {
    return { kind: 'unavailable', reason: 'Abra o cardápio para montar este item' };
  }
  const groups = (product as Product & { grupos_modificadores?: CatalogModifierGroup[] }).grupos_modificadores || [];
  const options = new Map(groups.flatMap(group => group.opcoes).filter(option => option.ativo !== false).map(option => [option.id, option]));
  const originalIds = (item.modificadores || []).map(modifier => modifier.id);
  const selectedIds = originalIds.filter(id => options.has(id));
  const configuration: RepeatConfiguration = {
    productId: product.id, observacao: item.observacao || '',
    clienteNome: item.clienteNome?.trim() || 'Consumo Geral', modifierIds: selectedIds,
  };
  if (selectedIds.length !== originalIds.length || groups.some(group => !modifierGroupSelectionValid(group, selectedIds))) {
    return { kind: 'configure', configuration };
  }
  if (selectedIds.some(id => !Number.isFinite(Number(options.get(id)!.preco_adicional)))) {
    return { kind: 'unavailable', reason: 'Confira este produto no cardápio' };
  }
  const modifiers = selectedIds.map(id => {
    const option = options.get(id)!;
    return { id, nome: option.nome, preco: Number(option.preco_adicional || 0) };
  });
  const extra = modifiers.reduce((sum, modifier) => sum + modifier.preco, 0);
  const unitPrice = Number(product.preco) + extra;
  if (!Number.isFinite(unitPrice) || unitPrice < 0) return { kind: 'unavailable', reason: 'Confira este produto no cardápio' };
  return {
    kind: 'quick', client: configuration.clienteNome, observation: configuration.observacao, unitPrice,
    product: { ...product, __selectedModifierIds: selectedIds, __selectedModifiers: modifiers, __selectedModifierTotal: extra },
  };
}

export function findRepeatedDraft(items: readonly DraftItem[], plan: Extract<RepeatPlan, { kind: 'quick' }>) {
  const ids = [...plan.product.__selectedModifierIds].sort().join('\u0000');
  const client = (name: string) => !name.trim() || name.trim().toLocaleLowerCase('pt-BR') === 'consumo geral' ? '' : name.trim();
  return items.find(item => item.produtoId === plan.product.id
    && client(item.clienteNome || '') === client(plan.client)
    && (item.observacao || '') === plan.observation
    && Number(item.preco) === plan.unitPrice
    && [...((item as DraftItem & { modificadorIds?: string[] }).modificadorIds || [])].sort().join('\u0000') === ids
    && (!(item as DraftItem & { modificadoresSelecionados?: { id: string }[] }).modificadoresSelecionados?.length
      || [...(item as DraftItem & { modificadoresSelecionados: { id: string }[] }).modificadoresSelecionados].map(modifier => modifier.id).sort().join('\u0000') === ids));
}
