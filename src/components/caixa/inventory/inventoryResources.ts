/** API resources owned by the inventory snapshot, not by individual forms. */
export const inventoryResources = {
  insumos: 'insumos',
  notas: 'notas',
  distribuidores: 'distribuidores',
  entradas: 'entradas',
  movimentacoes: 'movimentacoes',
  contagens: 'contagens',
  fichas: 'fichas-tecnicas',
} as const;
export type InventoryResource = keyof typeof inventoryResources;

export function inventoryResourcesForTab(tab: string): InventoryResource[] {
  if (tab === 'insumos') return ['insumos', 'fichas'];
  if (tab === 'fornecedores') return ['insumos', 'distribuidores'];
  if (tab === 'inventario' || tab === 'contagem') return ['insumos', 'contagens'];
  // History and its legacy aliases also open entry/movement forms.
  return ['insumos', 'distribuidores', 'notas', 'entradas', 'movimentacoes'];
}
