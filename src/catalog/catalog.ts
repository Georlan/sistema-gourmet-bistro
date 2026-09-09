import type { Product } from '../types';

export interface CatalogCategory {
  id: string;
  nome: string;
  destino_impressao: 'COZINHA' | 'BAR' | 'NENHUM' | string;
}

export interface CatalogModifierOption {
  id: string;
  grupo_id: string;
  nome: string;
  preco_adicional: number;
  ativo: boolean;
}

export interface CatalogModifierGroup {
  id: string;
  nome: string;
  min_selecoes: number;
  max_selecoes: number;
  tipo: 'obrigatorio' | 'opcional' | 'meio_a_meio' | string;
  opcoes: CatalogModifierOption[];
}

export interface CatalogProduct extends Product {
  categoria_id: string;
  categoria: string;
  categoria_detalhes?: CatalogCategory | null;
  imagens_galeria?: string[];
  grupos_modificadores?: CatalogModifierGroup[];
  ativo: boolean;
}

export interface CatalogSnapshot {
  categorias: CatalogCategory[];
  produtos: CatalogProduct[];
}

const byBusinessId = (a: { id: string }, b: { id: string }) =>
  String(a.id).localeCompare(String(b.id), 'pt-BR', {
    numeric: true,
    sensitivity: 'base',
  });

function normalizeModifierGroups(value: unknown): CatalogModifierGroup[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((group): group is Record<string, unknown> => Boolean(group) && typeof group === 'object')
    .map((group) => ({
      id: String(group.id ?? ''),
      nome: String(group.nome ?? ''),
      min_selecoes: Math.max(0, Number(group.min_selecoes ?? 0)),
      max_selecoes: Math.max(1, Number(group.max_selecoes ?? 1)),
      tipo: String(group.tipo ?? 'opcional'),
      opcoes: (Array.isArray(group.opcoes) ? group.opcoes : [])
        .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === 'object')
        .map((option) => ({
          id: String(option.id ?? ''),
          grupo_id: String(option.grupo_id ?? group.id ?? ''),
          nome: String(option.nome ?? ''),
          preco_adicional: Number(option.preco_adicional ?? 0),
          ativo: option.ativo !== false,
        }))
        .filter((option) => option.id && option.nome && Number.isFinite(option.preco_adicional)),
    }))
    .filter((group) => group.id && group.nome);
}

export function normalizeCatalogSnapshot(payload: unknown): CatalogSnapshot {
  const source = payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : {};
  const rawCategories = Array.isArray(source.categorias) ? source.categorias : [];
  const rawProducts = Array.isArray(source.produtos) ? source.produtos : [];

  const categorias = rawCategories
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: String(item.id ?? ''),
      nome: String(item.nome ?? ''),
      destino_impressao: String(item.destino_impressao ?? 'COZINHA'),
    }))
    .filter((item) => item.id && item.nome);

  const categoryById = new Map(categorias.map((category) => [category.id, category]));
  const produtos = rawProducts
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => {
      const categoriaId = String(item.categoria_id ?? '');
      const nestedCategory = item.categoria && typeof item.categoria === 'object'
        ? item.categoria as Record<string, unknown>
        : null;
      const categoria = categoryById.get(categoriaId) ?? (nestedCategory ? {
        id: String(nestedCategory.id ?? categoriaId),
        nome: String(nestedCategory.nome ?? ''),
        destino_impressao: String(nestedCategory.destino_impressao ?? 'COZINHA'),
      } : null);

      return {
        id: String(item.id ?? ''),
        nome: String(item.nome ?? ''),
        categoria_id: categoriaId,
        categoria: categoria?.nome ?? '',
        categoria_detalhes: categoria,
        preco: Number(item.preco ?? 0),
        descricao: String(item.descricao ?? ''),
        imagem: String(item.imagem ?? ''),
        imagens_galeria: Array.isArray(item.imagens_galeria)
          ? item.imagens_galeria.map(String)
          : [],
        grupos_modificadores: normalizeModifierGroups(item.grupos_modificadores),
        ativo: item.ativo !== false,
      } satisfies CatalogProduct;
    })
    .filter((item) => item.id && item.nome && item.categoria_id && Number.isFinite(item.preco))
    .sort(byBusinessId);

  return { categorias, produtos };
}

export function getSellableProducts(products: CatalogProduct[]): CatalogProduct[] {
  return products.filter((product) => product.ativo);
}
