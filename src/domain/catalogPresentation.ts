import { normalizeText } from './search';

/**
 * Safely extracts category name string from a string or JSON object.
 */
export function obterNomeCategoria(categoria: any): string {
  if (!categoria) return '';
  if (typeof categoria === 'object') {
    return categoria.nome || categoria.name || '';
  }
  return String(categoria);
}

type IngredientPresetProduct = {
  nome?: string | null;
  descricao?: string | null;
};

/**
 * Builds quick per-item adjustments only from ingredients explicitly mentioned
 * in the product name or description. This keeps SmartPOS shortcuts relevant
 * instead of showing the same generic observations for every product.
 */
export function getIngredientObservationPresets(product: IngredientPresetProduct): string[] {
  const searchableText = normalizeText(`${product.nome || ''} ${product.descricao || ''}`);
  if (!searchableText) return [];

  const paddedText = ` ${searchableText.replace(/\s+/g, ' ')} `;
  const hasAny = (...terms: string[]) =>
    terms.some((term) => paddedText.includes(` ${normalizeText(term).replace(/\s+/g, ' ')} `));
  const presets: string[] = [];
  const addWhenPresent = (label: string, ...terms: string[]) => {
    if (hasAny(...terms)) presets.push(`Sem ${label}`);
  };

  addWhenPresent('salada', 'salada');
  addWhenPresent('cebola', 'cebola');
  addWhenPresent('cheddar', 'cheddar');
  addWhenPresent('bacon', 'bacon');
  addWhenPresent('ovo', 'ovo');
  addWhenPresent('muçarela', 'muçarela', 'mussarela', 'mozzarella');
  addWhenPresent('gorgonzola', 'gorgonzola');
  addWhenPresent('provolone', 'provolone');
  addWhenPresent('parmesão', 'parmesão', 'parmesao');
  addWhenPresent('catupiry', 'catupiry');
  addWhenPresent('requeijão', 'requeijão', 'requeijao');
  addWhenPresent('queijo coalho', 'queijo coalho', 'coalho');

  const hasSpecificCheese = hasAny(
    'muçarela',
    'mussarela',
    'mozzarella',
    'gorgonzola',
    'provolone',
    'parmesão',
    'parmesao',
    'catupiry',
    'requeijão',
    'requeijao',
    'coalho'
  );
  if (!hasSpecificCheese) addWhenPresent('queijo', 'queijo', 'cheese');

  addWhenPresent('calabresa', 'calabresa');
  addWhenPresent('pepperoni', 'pepperoni');
  addWhenPresent('frango', 'frango');
  addWhenPresent('carne', 'carne', 'hambúrguer', 'hamburguer');
  addWhenPresent('presunto', 'presunto');
  addWhenPresent('camarão', 'camarão', 'camarao');
  addWhenPresent('molho', 'molho');
  addWhenPresent('barbecue', 'barbecue', 'barbeque');
  addWhenPresent('maionese', 'maionese');
  addWhenPresent('tomate', 'tomate');
  addWhenPresent('milho', 'milho');
  addWhenPresent('azeitona', 'azeitona');
  addWhenPresent('orégano', 'orégano', 'oregano');
  addWhenPresent('manjericão', 'manjericão', 'manjericao');
  addWhenPresent('azeite', 'azeite');
  addWhenPresent('abacaxi', 'abacaxi');
  addWhenPresent('palmito', 'palmito');
  addWhenPresent('pimentão', 'pimentão', 'pimentao');
  addWhenPresent('cogumelo', 'cogumelo', 'champignon');
  addWhenPresent('rúcula', 'rúcula', 'rucula');
  addWhenPresent('alho', 'alho');
  addWhenPresent('pimenta', 'pimenta');

  return Array.from(new Set(presets)).slice(0, 8);
}

/**
 * Dynamically generates observation presets based on product attributes and category.
 */
export function getProductPresets(product: { nome: string; descricao: string; categoria: any }): string[] {
  const presets: string[] = ['VIAGEM', 'PRA MESA'];

  const desc = (product.descricao || '').toLowerCase();
  const name = (product.nome || '').toLowerCase();
  const cat = obterNomeCategoria(product.categoria).toLowerCase();

  // Check ingredients in name/description
  if (desc.includes('salada') || name.includes('salada')) presets.push('sem salada');
  if (desc.includes('cebola') || name.includes('cebola')) presets.push('sem cebola');
  if (desc.includes('cheddar') || name.includes('cheddar')) presets.push('sem cheddar');
  if (desc.includes('bacon') || name.includes('bacon')) presets.push('sem bacon');
  if (desc.includes('ovo') || name.includes('ovo')) presets.push('sem ovo');
  if (
    desc.includes('queijo') ||
    desc.includes('coalho') ||
    desc.includes('muçarela') ||
    name.includes('queijo') ||
    name.includes('cheese')
  )
    presets.push('sem queijo');
  if (
    desc.includes('barbecue') ||
    desc.includes('barbeque') ||
    name.includes('barbecue') ||
    name.includes('costela') ||
    name.includes('picanha')
  )
    presets.push('sem barbecue');
  if (desc.includes('molho') || name.includes('molho')) presets.push('sem molho');
  if (desc.includes('maionese') || name.includes('maionese')) presets.push('sem maionese');
  if (desc.includes('tomate') || name.includes('tomate')) presets.push('sem tomate');
  if (desc.includes('milho') || name.includes('milho')) presets.push('sem milho');
  if (desc.includes('azeitona') || name.includes('azeitona')) presets.push('sem azeitona');
  if (desc.includes('presunto') || name.includes('presunto')) presets.push('sem presunto');
  if (desc.includes('orégano') || desc.includes('oregano') || name.includes('orégano')) presets.push('sem orégano');
  if (desc.includes('abacaxi') || name.includes('abacaxi')) presets.push('sem abacaxi');

  // Beverage specific options
  const catId = (product as any).categoria_id || (product as any).categoriaId || '';
  const isBeverage =
    catId === 'cat-refri' ||
    catId === 'cat-sucos' ||
    catId === 'cat-cervejas' ||
    catId === 'cat-quentes' ||
    cat.includes('bebida') ||
    cat.includes('suco') ||
    cat.includes('refrigerante') ||
    cat.includes('cerveja') ||
    name.includes('suco') ||
    name.includes('refrigerante') ||
    name.includes('heineken') ||
    name.includes('spaten');

  if (isBeverage) {
    presets.push('com gelo', 'sem gelo', 'com açúcar', 'sem açúcar', 'com limão');
  }

  // Remove duplicates and keep maximum 8 presets for clean UI layout
  return Array.from(new Set(presets)).slice(0, 8);
}
