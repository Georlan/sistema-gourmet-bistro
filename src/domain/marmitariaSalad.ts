/** Identifica o grupo de salada pelo nome do catálogo, sem IDs de restaurante. */
export function isMarmitariaSaladGroup(name: string): boolean {
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /(^|[^a-z])(saladas?|verduras?)(?=$|[^a-z])/.test(normalized);
}
