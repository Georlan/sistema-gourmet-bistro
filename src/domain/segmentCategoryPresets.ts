export type RestaurantSegmentPresetId =
  | 'hamburgueria'
  | 'pizzaria'
  | 'marmitaria'
  | 'pastelaria'
  | 'acaiteria'
  | 'restaurante';

export interface SegmentCategorySeed {
  id: string;
  nome: string;
  destino_impressao: 'COZINHA' | 'BAR' | 'NENHUM';
}

export interface RestaurantSegmentPreset {
  id: RestaurantSegmentPresetId;
  label: string;
  categories: SegmentCategorySeed[];
}

export const RESTAURANT_SEGMENT_PRESETS: RestaurantSegmentPreset[] = [
  {
    id: 'hamburgueria',
    label: 'Hamburgueria',
    categories: [
      { id: 'cat-hamburgueres', nome: 'Hambúrgueres', destino_impressao: 'COZINHA' },
      { id: 'cat-combos', nome: 'Combos', destino_impressao: 'COZINHA' },
      { id: 'cat-porcoes', nome: 'Porções e Batatas', destino_impressao: 'COZINHA' },
      { id: 'cat-bebidas', nome: 'Bebidas', destino_impressao: 'NENHUM' },
      { id: 'cat-sobremesas', nome: 'Sobremesas', destino_impressao: 'NENHUM' },
    ],
  },
  {
    id: 'pizzaria',
    label: 'Pizzaria',
    categories: [
      { id: 'cat-pizzas-tradicionais', nome: 'Pizzas Tradicionais', destino_impressao: 'COZINHA' },
      { id: 'cat-pizzas-especiais', nome: 'Pizzas Especiais', destino_impressao: 'COZINHA' },
      { id: 'cat-pizzas-doces', nome: 'Pizzas Doces', destino_impressao: 'COZINHA' },
      { id: 'cat-bordas-esfihas', nome: 'Esfihas e Calzones', destino_impressao: 'COZINHA' },
      { id: 'cat-bebidas', nome: 'Bebidas', destino_impressao: 'NENHUM' },
    ],
  },
  {
    id: 'marmitaria',
    label: 'Marmitaria / PF',
    categories: [
      { id: 'cat-pratos-executivos', nome: 'Pratos Executivos', destino_impressao: 'COZINHA' },
      { id: 'cat-porcoes-extras', nome: 'Porções Extras', destino_impressao: 'COZINHA' },
      { id: 'cat-bebidas', nome: 'Bebidas', destino_impressao: 'NENHUM' },
      { id: 'cat-sobremesas', nome: 'Sobremesas', destino_impressao: 'NENHUM' },
    ],
  },
  {
    id: 'pastelaria',
    label: 'Pastelaria',
    categories: [
      { id: 'cat-pasteis-salgados', nome: 'Pastéis Salgados', destino_impressao: 'COZINHA' },
      { id: 'cat-pasteis-doces', nome: 'Pastéis Doces', destino_impressao: 'COZINHA' },
      { id: 'cat-salgados', nome: 'Salgados e Porções', destino_impressao: 'COZINHA' },
      { id: 'cat-caldos-bebidas', nome: 'Caldo de Cana e Bebidas', destino_impressao: 'NENHUM' },
    ],
  },
  {
    id: 'acaiteria',
    label: 'Açaiteria',
    categories: [
      { id: 'cat-acai-montado', nome: 'Açaí no Copo / Tigela', destino_impressao: 'COZINHA' },
      { id: 'cat-vitaminas-cremes', nome: 'Cremes e Vitaminas', destino_impressao: 'COZINHA' },
      { id: 'cat-bebidas', nome: 'Águas e Bebidas', destino_impressao: 'NENHUM' },
    ],
  },
  {
    id: 'restaurante',
    label: 'Restaurante Tradicional',
    categories: [
      { id: 'cat-entradas', nome: 'Entradas', destino_impressao: 'COZINHA' },
      { id: 'cat-pratos-principais', nome: 'Pratos Principais', destino_impressao: 'COZINHA' },
      { id: 'cat-guarnicoes', nome: 'Guarnições', destino_impressao: 'COZINHA' },
      { id: 'cat-bebidas', nome: 'Bebidas', destino_impressao: 'NENHUM' },
      { id: 'cat-sobremesas', nome: 'Sobremesas', destino_impressao: 'NENHUM' },
    ],
  },
];

export function defaultPresetForOperationProfile(profile?: string | null): RestaurantSegmentPresetId {
  if (profile === 'pizzaria' || profile === 'marmitaria') return profile;
  if (profile === 'acai') return 'acaiteria';
  if (profile === 'churrasco') return 'restaurante';
  return 'hamburgueria';
}
