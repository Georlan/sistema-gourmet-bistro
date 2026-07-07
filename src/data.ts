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
    imagem: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '002',
    nome: '002 - Cheese Burguer',
    categoria: 'Hambúrgueres Bovinos',
    preco: 22.00,
    descricao: 'Hambúrguer bovino 120g, queijo coalho, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1550547660-d9450f859349?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '003',
    nome: '003 - Cheese Bacon',
    categoria: 'Hambúrgueres Bovinos',
    preco: 25.00,
    descricao: 'Hambúrguer bovino 120g, queijo coalho, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '004',
    nome: '004 - Cheese Egg',
    categoria: 'Hambúrgueres Bovinos',
    preco: 25.00,
    descricao: 'Hambúrguer bovino 120g, queijo coalho, ovo, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '005',
    nome: '005 - Duplo Burguer',
    categoria: 'Hambúrgueres Bovinos',
    preco: 29.00,
    descricao: '2 Hambúrgueres bovinos 120g, queijo cheddar, bacon e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1525164286253-04e11400c6d5?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '006',
    nome: '006 - Burguer Pôr do Sol',
    categoria: 'Hambúrgueres Bovinos',
    preco: 34.00,
    descricao: '2 Hambúrgueres bovinos 120g, queijo coalho, ovo, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1594212699903-ec8a3eca50f5?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '007',
    nome: '007 - Cheese Cupim',
    categoria: 'Hambúrgueres Bovinos',
    preco: 33.00,
    descricao: 'Cupim desfiado 120g, queijo coalho, geleia de pimenta e mel no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '008',
    nome: '008 - Hambúrguer Tropical',
    categoria: 'Hambúrgueres Bovinos',
    preco: 28.00,
    descricao: 'Hambúrguer bovino 120g, cream cheese, abacaxi grelhado, bacon, molho barbecue e molho de alho no pão brioche.',
    imagem: 'https://images.unsplash.com/photo-1572802419224-296b0aeee0d9?w=600&auto=format&fit=crop&q=80'
  },

  // Hambúrgueres de Frango
  {
    id: '071',
    nome: '071 - Hambúrguer de Frango',
    categoria: 'Hambúrgueres de Frango',
    preco: 19.00,
    descricao: 'Hambúrguer de frango 120g, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1625813506062-0aeb1d7a094b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '072',
    nome: '072 - Cheese Frango',
    categoria: 'Hambúrgueres de Frango',
    preco: 22.00,
    descricao: 'Hambúrguer de frango 120g, queijo coalho, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1512152272829-e3139592d56f?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '073',
    nome: '073 - Cheese Frango Bacon',
    categoria: 'Hambúrgueres de Frango',
    preco: 25.00,
    descricao: 'Hambúrguer de frango 120g, queijo coalho, bacon, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '074',
    nome: '074 - Cheese Frango Egg',
    categoria: 'Hambúrgueres de Frango',
    preco: 25.00,
    descricao: 'Hambúrguer de frango 120g, queijo coalho, ovo, cheddar cremoso e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1525059696034-4967a8e1dca2?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '075',
    nome: '075 - Duplo Frango Pôr do Sol',
    categoria: 'Hambúrgueres de Frango',
    preco: 32.00,
    descricao: '2 Hambúrgueres de frango 120g, queijo coalho, ovo, bacon, cheddar cremoso e molho de alho no pão brioche.',
    imagem: 'https://images.unsplash.com/photo-1550317138-10000687a72b?w=600&auto=format&fit=crop&q=80'
  },

  // Hambúrgueres Suínos
  {
    id: '601',
    nome: '601 - Hambúrguer Suíno',
    categoria: 'Hambúrgueres Suínos',
    preco: 19.00,
    descricao: 'Hambúrguer suíno 120g, geleia de pimenta e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '602',
    nome: '602 - Cheese Bacurim',
    categoria: 'Hambúrgueres Suínos',
    preco: 24.00,
    descricao: 'Hambúrguer suíno 120g, queijo cheddar, geleia de pimenta e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1582196346030-c052a97c9b83?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '603',
    nome: '603 - Pork Bacon',
    categoria: 'Hambúrgueres Suínos',
    preco: 27.00,
    descricao: 'Hambúrguer suíno 120g, queijo cheddar, bacon, geleia de pimenta e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '604',
    nome: '604 - Suinão da Casa',
    categoria: 'Hambúrgueres Suínos',
    preco: 32.00,
    descricao: '2 Hambúrgueres suínos 120g, queijo cheddar, cebola caramelizada e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1608750275742-694d21f74c4e?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '605',
    nome: '605 - Porcão do Sol',
    categoria: 'Hambúrgueres Suínos',
    preco: 36.00,
    descricao: '3 Hambúrgueres suínos 120g, queijo cheddar, queijo coalho, bacon, cebola caramelizada e molho de alho no pão brioche.',
    imagem: 'https://images.unsplash.com/photo-1603064752734-4c48fed724c6?w=600&auto=format&fit=crop&q=80'
  },

  // Baguetes
  {
    id: '016',
    nome: '016 - Baguete de Cupim',
    categoria: 'Baguetes',
    preco: 36.00,
    descricao: 'Cupim desfiado 120g, creme de queijo, e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '017',
    nome: '017 - Baguete de Filé',
    categoria: 'Baguetes',
    preco: 35.00,
    descricao: 'Filé em cubos 120g, abacaxi em cubos, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1554433607-66b5eed9d594?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '018',
    nome: '018 - Baguete de Coração',
    categoria: 'Baguetes',
    preco: 30.00,
    descricao: 'Coração de frango 120g, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1514516345957-556ca7d90a29?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '019',
    nome: '019 - Baguete de Frango',
    categoria: 'Baguetes',
    preco: 30.00,
    descricao: 'Frango em cubos 120g, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1562436260-8c9216eeb70a?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '020',
    nome: '020 - Baguete de Costela',
    categoria: 'Baguetes',
    preco: 36.00,
    descricao: 'Costela bovina desfiada, creme de queijo, molho barbecue, cebola caramelizada e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1559561853-08026f989595?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '021',
    nome: '021 - Baguete de Camarão',
    categoria: 'Baguetes',
    preco: 35.00,
    descricao: 'Camarão salteado, creme de queijo e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1534422298391-e4f8c172dddb?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '022',
    nome: '022 - Baguete de Picanha Bovina',
    categoria: 'Baguetes',
    preco: 38.00,
    descricao: 'Picanha bovina 120g, creme de queijo, molho barbecue e molho de alho no pão brioche. (Salada opcional).',
    imagem: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80'
  },

  // Pastéis Tradicionais
  {
    id: '051',
    nome: '051 - Pastel de Frango',
    categoria: 'Pastéis Tradicionais',
    preco: 12.00,
    descricao: 'Frango desfiado, queijo coalho e milho.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '052',
    nome: '052 - Pastel de Carne',
    categoria: 'Pastéis Tradicionais',
    preco: 12.00,
    descricao: 'Carne Moída, queijo coalho e cebola.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '053',
    nome: '053 - Pastel de Queijo',
    categoria: 'Pastéis Tradicionais',
    preco: 10.00,
    descricao: 'Queijo coalho, queijo muçarela e orégano.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '054',
    nome: '054 - Pastel Misto',
    categoria: 'Pastéis Tradicionais',
    preco: 12.00,
    descricao: 'Presunto, queijo coalho, tomate, azeitona e orégano.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '055',
    nome: '055 - Pastel Português',
    categoria: 'Pastéis Tradicionais',
    preco: 15.00,
    descricao: 'Calabresa, ovos cozidos, queijo coalho, azeitona e cebola.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '056',
    nome: '056 - Pastel de Lombinho',
    categoria: 'Pastéis Tradicionais',
    preco: 16.00,
    descricao: 'Lombinho canadense, cream cheese, azeitona e cebola.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '057',
    nome: '057 - Pastel de Calabresa',
    categoria: 'Pastéis Tradicionais',
    preco: 13.00,
    descricao: 'Calabresa, queijo cheddar, azeitona e cebola.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '058',
    nome: '058 - Pastel de Carne Cremosa',
    categoria: 'Pastéis Tradicionais',
    preco: 15.00,
    descricao: 'Carne moída, requeijão e cebola.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '059',
    nome: '059 - Pastel de Frango Cremoso',
    categoria: 'Pastéis Tradicionais',
    preco: 15.00,
    descricao: 'Frango desfiado, requeijão e molho de alho.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },

  // Pastéis Doces
  {
    id: '061',
    nome: '061 - Pastel de Banana',
    categoria: 'Pastéis Doces',
    preco: 12.00,
    descricao: 'Banana, queijo coalho, doce de leite e canela.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '062',
    nome: '062 - Pastel Romeu e Julieta',
    categoria: 'Pastéis Doces',
    preco: 12.00,
    descricao: 'Queijo coalho e goiabada.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '063',
    nome: '063 - Pastel de Ouro Branco',
    categoria: 'Pastéis Doces',
    preco: 19.00,
    descricao: 'Chocolate branco e bombons Ouro Branco.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '064',
    nome: '064 - Pastel de Chocolate',
    categoria: 'Pastéis Doces',
    preco: 16.00,
    descricao: 'Chocolate. (Branco ou ao leite).',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '065',
    nome: '065 - Pastel Chocolate com Banana',
    categoria: 'Pastéis Doces',
    preco: 16.00,
    descricao: 'Chocolate e banana.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },

  // Pastelões Especiais
  {
    id: '031',
    nome: '031 - Pastelão de Cupim',
    categoria: 'Pastelões Especiais',
    preco: 34.00,
    descricao: 'Cupim desfiado, requeijão e queijo muçarela.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '032',
    nome: '032 - Pastelão de Filé',
    categoria: 'Pastelões Especiais',
    preco: 34.00,
    descricao: 'Filé bovino, queijo muçarela, abacaxi e requeijão.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '033',
    nome: '033 - Pastelão de Frango',
    categoria: 'Pastelões Especiais',
    preco: 22.00,
    descricao: 'Frango desfiado, muçarela e milho.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '034',
    nome: '034 - Pastelão de Frango Catupiry',
    categoria: 'Pastelões Especiais',
    preco: 24.00,
    descricao: 'Frango desfiado, requeijão e milho.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '036',
    nome: '036 - Pastelão de Camarão',
    categoria: 'Pastelões Especiais',
    preco: 32.00,
    descricao: 'Camarão salteado, queijo muçarela e requeijão.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '037',
    nome: '037 - Pastelão Pôr do Sol',
    categoria: 'Pastelões Especiais',
    preco: 32.00,
    descricao: 'Carne moída, presunto, ovo, bacon, queijo muçarela, cream cheese, milho e azeitona.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },

  // Petiscos
  {
    id: '041',
    nome: '041 - Batata da Casa',
    categoria: 'Petiscos',
    preco: 35.90,
    descricao: 'Batata frita 400g, cupim desfiado, bacon em cubos e requeijão.',
    imagem: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '042',
    nome: '042 - Batata Tradicional',
    categoria: 'Petiscos',
    preco: 12.90,
    descricao: 'Batata frita 250g e cheddar cremoso.',
    imagem: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '043',
    nome: '043 - Batata Tailandesa',
    categoria: 'Petiscos',
    preco: 28.90,
    descricao: 'Batata frita 400g, frango, bacon em cubos e molhos variados.',
    imagem: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '044',
    nome: '044 - Batata com Bacon',
    categoria: 'Petiscos',
    preco: 18.90,
    descricao: 'Batata frita 250g, bacon em cubos e cheddar cremoso.',
    imagem: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '045',
    nome: '045 - Tirinhas de Pastel Doce',
    categoria: 'Petiscos',
    preco: 14.90,
    descricao: 'Tiras de pastel sem recheio, acompanhadas com chocolate ou doce de leite.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '046',
    nome: '046 - Tirinhas de Pastel com Queijo',
    categoria: 'Petiscos',
    preco: 18.90,
    descricao: 'Tiras de pastel com queijo, acompanhadas de goiabada ou geleia de pimenta.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '047',
    nome: '047 - Pastelzinho de Cupim',
    categoria: 'Petiscos',
    preco: 28.90,
    descricao: '6 Mini pastéis recheados com cupim e cream cheese.',
    imagem: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?w=600&auto=format&fit=crop&q=80'
  },

  // Combos
  {
    id: '201',
    nome: '201 - Combo Família',
    categoria: 'Combos Promocionais',
    preco: 79.90,
    descricao: 'Baguete de cupim, baguete de frango, batata tradicional e refrigerante 1L.',
    imagem: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '202',
    nome: '202 - Combo Amizade',
    categoria: 'Combos Promocionais',
    preco: 59.90,
    descricao: '2 Cheese bacons, batata tradicional e refrigerante 600mL.',
    imagem: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '203',
    nome: '203 - Combo Individual',
    categoria: 'Combos Promocionais',
    preco: 45.90,
    descricao: 'Burguer pôr do sol, batata tradicional e refrigerante em lata.',
    imagem: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '204',
    nome: '204 - Combo da Paixão',
    categoria: 'Combos Promocionais',
    preco: 52.90,
    descricao: '2 Cheese burguers, batata tradicional e refrigerante 600mL.',
    imagem: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '205',
    nome: '205 - Combo Triplo',
    categoria: 'Combos Promocionais',
    preco: 87.90,
    descricao: '3 Cheese bacons, batata tradicional e refrigerante 1L.',
    imagem: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: '206',
    nome: '206 - Combo Suíno Individual',
    categoria: 'Combos Promocionais',
    preco: 49.90,
    descricao: 'Porcão do sol, batata tradicional e refrigerante em lata.',
    imagem: 'https://images.unsplash.com/photo-1606787366850-de6330128bfc?w=600&auto=format&fit=crop&q=80'
  },

  // Bebidas - Sucos
  {
    id: 'suc-01',
    nome: 'Suco de Goiaba 500mL',
    categoria: 'Sucos',
    preco: 8.00,
    descricao: 'Suco de goiaba natural, batido e gelado.',
    imagem: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'suc-02',
    nome: 'Suco de Maracujá 500mL',
    categoria: 'Sucos',
    preco: 10.00,
    descricao: 'Suco de maracujá natural, batido e gelado.',
    imagem: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'suc-03',
    nome: 'Suco de Laranja 500mL',
    categoria: 'Sucos',
    preco: 10.00,
    descricao: 'Suco de laranja natural, espremido na hora.',
    imagem: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'suc-04',
    nome: 'Suco de Caju 500mL',
    categoria: 'Sucos',
    preco: 8.00,
    descricao: 'Suco de caju de polpa selecionada.',
    imagem: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'suc-05',
    nome: 'Suco de Manga 500mL',
    categoria: 'Sucos',
    preco: 8.00,
    descricao: 'Suco de manga cremoso e gelado.',
    imagem: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'suc-06',
    nome: 'Suco de Abacaxi 500mL',
    categoria: 'Sucos',
    preco: 10.00,
    descricao: 'Suco de abacaxi natural, doce e refrescante.',
    imagem: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=600&auto=format&fit=crop&q=80'
  },

  // Bebidas - Refrigerantes
  {
    id: 'ref-01',
    nome: 'Refrigerante 1L',
    categoria: 'Refrigerantes e Águas',
    preco: 12.00,
    descricao: 'Garrafa pet de 1 litro gelada.',
    imagem: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'ref-02',
    nome: 'Refrigerante 600mL',
    categoria: 'Refrigerantes e Águas',
    preco: 8.00,
    descricao: 'Garrafa de 600ml gelada.',
    imagem: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'ref-03',
    nome: 'Refrigerante Lata',
    categoria: 'Refrigerantes e Águas',
    preco: 6.00,
    descricao: 'Lata de refrigerante gelada.',
    imagem: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'ref-04',
    nome: 'Água Tônica',
    categoria: 'Refrigerantes e Águas',
    preco: 6.00,
    descricao: 'Lata de água tônica.',
    imagem: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'ref-05',
    nome: 'Água sem Gás',
    categoria: 'Refrigerantes e Águas',
    preco: 3.00,
    descricao: 'Garrafa de água mineral sem gás.',
    imagem: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'ref-06',
    nome: 'Água com Gás',
    categoria: 'Refrigerantes e Águas',
    preco: 3.00,
    descricao: 'Garrafa de água mineral com gás.',
    imagem: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'ref-07',
    nome: 'Água de Coco',
    categoria: 'Refrigerantes e Águas',
    preco: 5.00,
    descricao: 'Copo de água de coco natural.',
    imagem: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'ref-08',
    nome: 'H2O (Limão ou Limoneto)',
    categoria: 'Refrigerantes e Águas',
    preco: 7.00,
    descricao: 'Garrafa de H2O gelada.',
    imagem: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=600&auto=format&fit=crop&q=80'
  },

  // Cervejas
  {
    id: 'cer-01',
    nome: 'Heineken Long Neck',
    categoria: 'Cervejas',
    preco: 12.00,
    descricao: 'Cerveja Heineken long neck super gelada.',
    imagem: 'https://images.unsplash.com/photo-1564327021814-a211a19acd8a?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'cer-02',
    nome: 'Spaten Long Neck',
    categoria: 'Cervejas',
    preco: 12.00,
    descricao: 'Cerveja Spaten long neck geladíssima.',
    imagem: 'https://images.unsplash.com/photo-1564327021814-a211a19acd8a?w=600&auto=format&fit=crop&q=80'
  },

  // Bebidas Quentes (Doses)
  {
    id: 'dos-01',
    nome: 'Black & White (dose)',
    categoria: 'Bebidas Quentes',
    preco: 6.00,
    descricao: 'Dose de whisky Black & White.',
    imagem: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'dos-02',
    nome: 'Red Label (dose)',
    categoria: 'Bebidas Quentes',
    preco: 8.00,
    descricao: 'Dose de whisky Johnnie Walker Red Label.',
    imagem: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'dos-03',
    nome: 'Vodka Orloff (dose)',
    categoria: 'Bebidas Quentes',
    preco: 5.00,
    descricao: 'Dose de vodka Orloff.',
    imagem: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'dos-04',
    nome: 'Rum Montilla (dose)',
    categoria: 'Bebidas Quentes',
    preco: 5.00,
    descricao: 'Dose de rum Montilla.',
    imagem: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&auto=format&fit=crop&q=80'
  },
  {
    id: 'dos-05',
    nome: 'Campari (dose)',
    categoria: 'Bebidas Quentes',
    preco: 5.00,
    descricao: 'Dose de Campari original.',
    imagem: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&auto=format&fit=crop&q=80'
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
