export function getProductCatalogSignalLabel(category: string | null | undefined): string | null {
  const value = String(category || '');
  if (/oferta/i.test(value)) return 'Oferta';
  if (/promo(?:c[aã]o|ç[aã]o)?/i.test(value)) return 'Promoção';
  if (/campanha/i.test(value)) return 'Campanha';
  if (/especia(?:l|is)/i.test(value)) return 'Especial';
  if (/destaque/i.test(value)) return 'Destaque';
  return null;
}
