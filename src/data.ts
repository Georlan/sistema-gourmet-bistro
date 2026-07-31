/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Product, Waiter, Table } from './types';

// ============================================================================
// 🏢 CONFIGURAÇÕES DE PERSONALIZAÇÃO (SaaS / White-Label)
// Altere as variáveis abaixo para customizar o app para outro cliente rapidamente.
// ============================================================================
export const RESTAURANT_CONFIG = {
  nomePadrao: "Kôma",
  totalMesas: 30,           // Define o número total de mesas exibidas no mapa
  capacidadePadraoMesa: 4,  // Capacidade padrão de pessoas por mesa
};

export const CATEGORIES = [
  'Hambúrgueres Bovinos',
  'Hambúrgueres de Frango',
  'Hambúrgueres Suínos',
  'Baguetes',
  'Pastéis Tradicionais',
  'Pastelões Especiais',
  'Pastéis Doces',
  'Petiscos',
  'Combos Promocionais',
  'Sucos',
  'Refrigerantes e Águas',
  'Cervejas',
  'Bebidas Quentes'
];

export const PRODUCTS: Product[] = [
  // Hambúrgueres Bovinos
  {
    id: '001',
    nome: '001 - Hambúrguer Tradicional',
    categoria: 'Hambúrgueres Bovinos',
    preco: 19.00,
    descricao: 'Hambúrguer bovino 120g, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '002',
    nome: '002 - Cheese Burguer',
    categoria: 'Hambúrgueres Bovinos',
    preco: 22.00,
    descricao: 'Hambúrguer bovino 120g, queijo coalho, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '003',
    nome: '003 - Cheese Bacon',
    categoria: 'Hambúrgueres Bovinos',
    preco: 25.00,
    descricao: 'Hambúrguer bovino 120g, queijo coalho, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '004',
    nome: '004 - Cheese Egg',
    categoria: 'Hambúrgueres Bovinos',
    preco: 25.00,
    descricao: 'Hambúrguer bovino 120g, queijo coalho, ovo, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '005',
    nome: '005 - Duplo Burguer',
    categoria: 'Hambúrgueres Bovinos',
    preco: 29.00,
    descricao: '2 Hambúrgueres bovinos 120g, queijo cheddar, bacon e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '006',
    nome: '006 - Burguer Pôr do Sol',
    categoria: 'Hambúrgueres Bovinos',
    preco: 34.00,
    descricao: '2 Hambúrgueres bovinos 120g, queijo coalho, ovo, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '007',
    nome: '007 - Cheese Cupim',
    categoria: 'Hambúrgueres Bovinos',
    preco: 33.00,
    descricao: 'Cupim desfiado 120g, queijo coalho, geleia de pimenta e mel no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '008',
    nome: '008 - Hambúrguer Tropical',
    categoria: 'Hambúrgueres Bovinos',
    preco: 28.00,
    descricao: 'Hambúrguer bovino 120g, cream cheese, abacaxi grelhado, bacon, molho barbecue e molho de alho no pão brioche.',
    imagem: ''
  },

  // Hambúrgueres de Frango
  {
    id: '071',
    nome: '071 - Hambúrguer de Frango',
    categoria: 'Hambúrgueres de Frango',
    preco: 19.00,
    descricao: 'Hambúrguer de frango 120g, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '072',
    nome: '072 - Cheese Frango',
    categoria: 'Hambúrgueres de Frango',
    preco: 22.00,
    descricao: 'Hambúrguer de frango 120g, queijo coalho, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '073',
    nome: '073 - Cheese Frango Bacon',
    categoria: 'Hambúrgueres de Frango',
    preco: 25.00,
    descricao: 'Hambúrguer de frango 120g, queijo coalho, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '074',
    nome: '074 - Cheese Frango Egg',
    categoria: 'Hambúrgueres de Frango',
    preco: 25.00,
    descricao: 'Hambúrguer de frango 120g, queijo coalho, ovo, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '075',
    nome: '075 - Duplo Frango Pôr do Sol',
    categoria: 'Hambúrgueres de Frango',
    preco: 32.00,
    descricao: '2 Hambúrgueres de frango 120g, queijo coalho, ovo, bacon, cheddar cremoso e molho de alho no pão brioche.',
    imagem: ''
  },

  // Hambúrgueres Suínos
  {
    id: '601',
    nome: '601 - Hambúrguer Suíno',
    categoria: 'Hambúrgueres Suínos',
    preco: 19.00,
    descricao: 'Hambúrguer suíno 120g, geleia de pimenta e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '602',
    nome: '602 - Cheese Bacurim',
    categoria: 'Hambúrgueres Suínos',
    preco: 24.00,
    descricao: 'Hambúrguer suíno 120g, queijo cheddar, geleia de pimenta e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '603',
    nome: '603 - Pork Bacon',
    categoria: 'Hambúrgueres Suínos',
    preco: 27.00,
    descricao: 'Hambúrguer suíno 120g, queijo cheddar, bacon, geleia de pimenta e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '604',
    nome: '604 - Suinão da Casa',
    categoria: 'Hambúrgueres Suínos',
    preco: 32.00,
    descricao: '2 Hambúrgueres suínos 120g, queijo cheddar, cebola caramelizada e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '605',
    nome: '605 - Porcão do Sol',
    categoria: 'Hambúrgueres Suínos',
    preco: 36.00,
    descricao: '3 Hambúrgueres suínos 120g, queijo cheddar, queijo coalho, bacon, cebola caramelizada e molho de alho no pão brioche.',
    imagem: ''
  },

  // Baguetes
  {
    id: '016',
    nome: '016 - Baguete de Cupim',
    categoria: 'Baguetes',
    preco: 36.00,
    descricao: 'Cupim desfiado 120g, creme de queijo, e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '017',
    nome: '017 - Baguete de Filé',
    categoria: 'Baguetes',
    preco: 35.00,
    descricao: 'Filé em cubos 120g, abacaxi em cubos, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '018',
    nome: '018 - Baguete de Coração',
    categoria: 'Baguetes',
    preco: 30.00,
    descricao: 'Coração de frango 120g, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '019',
    nome: '019 - Baguete de Frango',
    categoria: 'Baguetes',
    preco: 30.00,
    descricao: 'Frango em cubos 120g, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '020',
    nome: '020 - Baguete de Costela',
    categoria: 'Baguetes',
    preco: 36.00,
    descricao: 'Costela bovina desfiada, creme de queijo, molho barbecue, cebola caramelizada e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '021',
    nome: '021 - Baguete de Camarão',
    categoria: 'Baguetes',
    preco: 35.00,
    descricao: 'Camarão salteado, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },
  {
    id: '022',
    nome: '022 - Baguete de Picanha Bovina',
    categoria: 'Baguetes',
    preco: 38.00,
    descricao: 'Picanha bovina 120g, creme de queijo, molho barbecue e molho de alho no pão brioche. (Salada opcional).',
    imagem: ''
  },

  // Pastéis Tradicionais
  {
    id: '051',
    nome: '051 - Pastel de Frango',
    categoria: 'Pastéis Tradicionais',
    preco: 12.00,
    descricao: 'Frango desfiado, queijo coalho e milho.',
    imagem: ''
  },
  {
    id: '052',
    nome: '052 - Pastel de Carne',
    categoria: 'Pastéis Tradicionais',
    preco: 12.00,
    descricao: 'Carne Moída, queijo coalho e cebola.',
    imagem: ''
  },
  {
    id: '053',
    nome: '053 - Pastel de Queijo',
    categoria: 'Pastéis Tradicionais',
    preco: 10.00,
    descricao: 'Queijo coalho, queijo muçarela e orégano.',
    imagem: ''
  },
  {
    id: '054',
    nome: '054 - Pastel Misto',
    categoria: 'Pastéis Tradicionais',
    preco: 12.00,
    descricao: 'Presunto, queijo coalho, tomate, azeitona e orégano.',
    imagem: ''
  },
  {
    id: '055',
    nome: '055 - Pastel Português',
    categoria: 'Pastéis Tradicionais',
    preco: 15.00,
    descricao: 'Calabresa, ovos cozidos, queijo coalho, azeitona e cebola.',
    imagem: ''
  },
  {
    id: '056',
    nome: '056 - Pastel de Lombinho',
    categoria: 'Pastéis Tradicionais',
    preco: 16.00,
    descricao: 'Lombinho canadense, cream cheese, azeitona e cebola.',
    imagem: ''
  },
  {
    id: '057',
    nome: '057 - Pastel de Calabresa',
    categoria: 'Pastéis Tradicionais',
    preco: 13.00,
    descricao: 'Calabresa, queijo cheddar, azeitona e cebola.',
    imagem: ''
  },
  {
    id: '058',
    nome: '058 - Pastel de Carne Cremosa',
    categoria: 'Pastéis Tradicionais',
    preco: 15.00,
    descricao: 'Carne moída, requeijão e cebola.',
    imagem: ''
  },
  {
    id: '059',
    nome: '059 - Pastel de Frango Cremoso',
    categoria: 'Pastéis Tradicionais',
    preco: 15.00,
    descricao: 'Frango desfiado, requeijão e molho de alho.',
    imagem: ''
  },

  // Pastéis Doces
  {
    id: '061',
    nome: '061 - Pastel de Banana',
    categoria: 'Pastéis Doces',
    preco: 12.00,
    descricao: 'Banana, queijo coalho, doce de leite e canela.',
    imagem: ''
  },
  {
    id: '062',
    nome: '062 - Pastel Romeu e Julieta',
    categoria: 'Pastéis Doces',
    preco: 12.00,
    descricao: 'Queijo coalho e goiabada.',
    imagem: ''
  },
  {
    id: '063',
    nome: '063 - Pastel de Ouro Branco',
    categoria: 'Pastéis Doces',
    preco: 19.00,
    descricao: 'Chocolate branco e bombons Ouro Branco.',
    imagem: ''
  },
  {
    id: '064',
    nome: '064 - Pastel de Chocolate',
    categoria: 'Pastéis Doces',
    preco: 16.00,
    descricao: 'Chocolate. (Branco ou ao leite).',
    imagem: ''
  },
  {
    id: '065',
    nome: '065 - Pastel Chocolate com Banana',
    categoria: 'Pastéis Doces',
    preco: 16.00,
    descricao: 'Chocolate e banana.',
    imagem: ''
  },

  // Pastelões Especiais
  {
    id: '031',
    nome: '031 - Pastelão de Cupim',
    categoria: 'Pastelões Especiais',
    preco: 34.00,
    descricao: 'Cupim desfiado, requeijão e queijo muçarela.',
    imagem: ''
  },
  {
    id: '032',
    nome: '032 - Pastelão de Filé',
    categoria: 'Pastelões Especiais',
    preco: 34.00,
    descricao: 'Filé bovino, queijo muçarela, abacaxi e requeijão.',
    imagem: ''
  },
  {
    id: '033',
    nome: '033 - Pastelão de Frango',
    categoria: 'Pastelões Especiais',
    preco: 22.00,
    descricao: 'Frango desfiado, muçarela e milho.',
    imagem: ''
  },
  {
    id: '034',
    nome: '034 - Pastelão de Frango Catupiry',
    categoria: 'Pastelões Especiais',
    preco: 24.00,
    descricao: 'Frango desfiado, requeijão e milho.',
    imagem: ''
  },
  {
    id: '036',
    nome: '036 - Pastelão de Camarão',
    categoria: 'Pastelões Especiais',
    preco: 32.00,
    descricao: 'Camarão salteado, queijo muçarela e requeijão.',
    imagem: ''
  },
  {
    id: '037',
    nome: '037 - Pastelão Pôr do Sol',
    categoria: 'Pastelões Especiais',
    preco: 32.00,
    descricao: 'Carne moída, presunto, ovo, bacon, queijo muçarela, cream cheese, milho e azeitona.',
    imagem: ''
  },

  // Petiscos
  {
    id: '041',
    nome: '041 - Batata da Casa',
    categoria: 'Petiscos',
    preco: 35.90,
    descricao: 'Batata frita 400g, cupim desfiado, bacon em cubos e requeijão.',
    imagem: ''
  },
  {
    id: '042',
    nome: '042 - Batata Tradicional',
    categoria: 'Petiscos',
    preco: 12.90,
    descricao: 'Batata frita 250g e cheddar cremoso.',
    imagem: ''
  },
  {
    id: '043',
    nome: '043 - Batata Tailandesa',
    categoria: 'Petiscos',
    preco: 28.90,
    descricao: 'Batata frita 400g, frango, bacon em cubos e molhos variados.',
    imagem: ''
  },
  {
    id: '044',
    nome: '044 - Batata com Bacon',
    categoria: 'Petiscos',
    preco: 18.90,
    descricao: 'Batata frita 250g, bacon em cubos e cheddar cremoso.',
    imagem: ''
  },
  {
    id: '045',
    nome: '045 - Tirinhas de Pastel Doce',
    categoria: 'Petiscos',
    preco: 14.90,
    descricao: 'Tiras de pastel sem recheio, acompanhadas com chocolate ou doce de leite.',
    imagem: ''
  },
  {
    id: '046',
    nome: '046 - Tirinhas de Pastel com Queijo',
    categoria: 'Petiscos',
    preco: 18.90,
    descricao: 'Tiras de pastel com queijo, acompanhadas de goiabada ou geleia de pimenta.',
    imagem: ''
  },
  {
    id: '047',
    nome: '047 - Pastelzinho de Cupim',
    categoria: 'Petiscos',
    preco: 28.90,
    descricao: '6 Mini pastéis recheados com cupim e cream cheese.',
    imagem: ''
  },

  // Combos
  {
    id: '201',
    nome: '201 - Combo Família',
    categoria: 'Combos Promocionais',
    preco: 79.90,
    descricao: 'Baguete de cupim, baguete de frango, batata tradicional e refrigerante 1L.',
    imagem: ''
  },
  {
    id: '202',
    nome: '202 - Combo Amizade',
    categoria: 'Combos Promocionais',
    preco: 59.90,
    descricao: '2 Cheese bacons, batata tradicional e refrigerante 600mL.',
    imagem: ''
  },
  {
    id: '203',
    nome: '203 - Combo Individual',
    categoria: 'Combos Promocionais',
    preco: 45.90,
    descricao: 'Burguer pôr do sol, batata tradicional e refrigerante em lata.',
    imagem: ''
  },
  {
    id: '204',
    nome: '204 - Combo da Paixão',
    categoria: 'Combos Promocionais',
    preco: 52.90,
    descricao: '2 Cheese burguers, batata tradicional e refrigerante 600mL.',
    imagem: ''
  },
  {
    id: '205',
    nome: '205 - Combo Triplo',
    categoria: 'Combos Promocionais',
    preco: 87.90,
    descricao: '3 Cheese bacons, batata tradicional e refrigerante 1L.',
    imagem: ''
  },
  {
    id: '206',
    nome: '206 - Combo Suíno Individual',
    categoria: 'Combos Promocionais',
    preco: 49.90,
    descricao: 'Porcão do sol, batata tradicional e refrigerante em lata.',
    imagem: ''
  },

  // Bebidas - Sucos
  {
    id: 'suc-01',
    nome: 'Suco de Goiaba 500mL',
    categoria: 'Sucos',
    preco: 8.00,
    descricao: 'Suco de goiaba natural, batido e gelado.',
    imagem: ''
  },
  {
    id: 'suc-02',
    nome: 'Suco de Maracujá 500mL',
    categoria: 'Sucos',
    preco: 10.00,
    descricao: 'Suco de maracujá natural, batido e gelado.',
    imagem: ''
  },
  {
    id: 'suc-03',
    nome: 'Suco de Laranja 500mL',
    categoria: 'Sucos',
    preco: 10.00,
    descricao: 'Suco de laranja natural, espremido na hora.',
    imagem: ''
  },
  {
    id: 'suc-04',
    nome: 'Suco de Caju 500mL',
    categoria: 'Sucos',
    preco: 8.00,
    descricao: 'Suco de caju de polpa selecionada.',
    imagem: ''
  },
  {
    id: 'suc-05',
    nome: 'Suco de Manga 500mL',
    categoria: 'Sucos',
    preco: 8.00,
    descricao: 'Suco de manga cremoso e gelado.',
    imagem: ''
  },
  {
    id: 'suc-06',
    nome: 'Suco de Abacaxi 500mL',
    categoria: 'Sucos',
    preco: 10.00,
    descricao: 'Suco de abacaxi natural, doce e refrescante.',
    imagem: ''
  },

  // Bebidas - Refrigerantes
  {
    id: 'ref-01',
    nome: 'Refrigerante 1L',
    categoria: 'Refrigerantes e Águas',
    preco: 12.00,
    descricao: 'Garrafa pet de 1 litro gelada.',
    imagem: ''
  },
  {
    id: 'ref-02',
    nome: 'Refrigerante 600mL',
    categoria: 'Refrigerantes e Águas',
    preco: 8.00,
    descricao: 'Garrafa de 600ml gelada.',
    imagem: ''
  },
  {
    id: 'ref-03',
    nome: 'Refrigerante Lata',
    categoria: 'Refrigerantes e Águas',
    preco: 6.00,
    descricao: 'Lata de refrigerante gelada.',
    imagem: ''
  },
  {
    id: 'ref-04',
    nome: 'Água Tônica',
    categoria: 'Refrigerantes e Águas',
    preco: 6.00,
    descricao: 'Lata de água tônica.',
    imagem: ''
  },
  {
    id: 'ref-05',
    nome: 'Água sem Gás',
    categoria: 'Refrigerantes e Águas',
    preco: 3.00,
    descricao: 'Garrafa de água mineral sem gás.',
    imagem: ''
  },
  {
    id: 'ref-06',
    nome: 'Água com Gás',
    categoria: 'Refrigerantes e Águas',
    preco: 3.00,
    descricao: 'Garrafa de água mineral com gás.',
    imagem: ''
  },
  {
    id: 'ref-07',
    nome: 'Água de Coco',
    categoria: 'Refrigerantes e Águas',
    preco: 5.00,
    descricao: 'Copo de água de coco natural.',
    imagem: ''
  },
  {
    id: 'ref-08',
    nome: 'H2O (Limão ou Limoneto)',
    categoria: 'Refrigerantes e Águas',
    preco: 7.00,
    descricao: 'Garrafa de H2O gelada.',
    imagem: ''
  },

  // Cervejas
  {
    id: 'cer-01',
    nome: 'Heineken Long Neck',
    categoria: 'Cervejas',
    preco: 12.00,
    descricao: 'Cerveja Heineken long neck super gelada.',
    imagem: ''
  },
  {
    id: 'cer-02',
    nome: 'Spaten Long Neck',
    categoria: 'Cervejas',
    preco: 12.00,
    descricao: 'Cerveja Spaten long neck geladíssima.',
    imagem: ''
  },

  // Bebidas Quentes (Doses)
  {
    id: 'dos-01',
    nome: 'Black & White (dose)',
    categoria: 'Bebidas Quentes',
    preco: 6.00,
    descricao: 'Dose de whisky Black & White.',
    imagem: ''
  },
  {
    id: 'dos-02',
    nome: 'Red Label (dose)',
    categoria: 'Bebidas Quentes',
    preco: 8.00,
    descricao: 'Dose de whisky Johnnie Walker Red Label.',
    imagem: ''
  },
  {
    id: 'dos-03',
    nome: 'Vodka Orloff (dose)',
    categoria: 'Bebidas Quentes',
    preco: 5.00,
    descricao: 'Dose de vodka Orloff.',
    imagem: ''
  },
  {
    id: 'dos-04',
    nome: 'Rum Montilla (dose)',
    categoria: 'Bebidas Quentes',
    preco: 5.00,
    descricao: 'Dose de rum Montilla.',
    imagem: ''
  },
  {
    id: 'dos-05',
    nome: 'Campari (dose)',
    categoria: 'Bebidas Quentes',
    preco: 5.00,
    descricao: 'Dose de Campari original.',
    imagem: ''
  }
];

// Gera as mesas dinamicamente com base nas configurações White-Label
export const TABLES: Table[] = Array.from({ length: RESTAURANT_CONFIG.totalMesas }, (_, idx) => ({
  id: idx + 1,
  capacidade: RESTAURANT_CONFIG.capacidadePadraoMesa
}));

export const WAITERS: Waiter[] = [
  { id: 'g-01', nome: 'Georlan' },
  { id: 'g-02', nome: 'Mateus' },
  { id: 'g-03', nome: 'Sarah' },
  { id: 'g-04', nome: 'Thiago' }
];
