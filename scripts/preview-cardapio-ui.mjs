/**
 * Local-only, read-only visual preview API for the public KÔMA cardápio.
 *
 * Run in a SECOND terminal while Vite is running on localhost:3000:
 *   node scripts/preview-cardapio-ui.mjs
 * Open:
 *   http://localhost:3000/c/preview-ui
 *
 * All products, names and prices are fictitious. No database, Railway or
 * production API is contacted. Every non-GET operation is refused.
 */
import { createServer } from 'node:http';

const PORT = 8000;
const HOSTS = ['127.0.0.1', '::1'];
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);
const RESTAURANT_ID = 990001;
const payload = {
  restaurante: {
    id: RESTAURANT_ID,
    nome: 'KÔMA · Prévia visual',
    slug: 'preview-ui',
    subtitulo: 'DEMONSTRAÇÃO — nenhum pedido será enviado',
    aceitando_pedidos: true,
    origem_disponibilidade: 'forced_open',
    status_override: 'Forçado Aberto',
    delivery_ativo: true,
    taxa_entrega_padrao: 7.0,
    tempo_entrega_estimado_min: 30,
    tempo_entrega_estimado_max: 45,
    tempo_retirada_estimado_min: 15,
    tempo_retirada_estimado_max: 25,
    pedido_minimo_valor: 20.0,
    tipos_pedido_ativos: ['delivery', 'retirada', 'consumo_local'],
    formas_pagamento_aceitas: ['Pix', 'Cartão de Crédito', 'Dinheiro'],
    beneficios: { coupons: true, loyalty: true, cashback: true },
    pagamento_online_ativo: false,
    conta_cliente_obrigatoria: false,
    telefone: '(11) 98765-4321',
    whatsapp: '11987654321',
    socials: JSON.stringify({ instagram: 'komagastronomia', whatsapp: '11987654321' }),
    endereco: 'Rua Harmonia, 123 - Vila Madalena, São Paulo - SP',
    horario_funcionamento: 'Terça a Domingo: 18h00 às 23h30',
    logo_url: '',
    banner_url: '',
  },
  categorias: [
    { id: 1, nome: 'Burgers' },
    { id: 2, nome: 'Combos' },
    { id: 3, nome: 'Porções' },
    { id: 4, nome: 'Bebidas' },
    { id: 5, nome: 'Sobremesas' },
  ],
  produtos: [
    {
      id: 990011,
      nome: 'Burger clássico artesanal',
      descricao: 'Blend 160g grelhado no fogo, cheddar cremoso, cebola caramelizada e pão brioche selado na manteiga.',
      preco: 34.9,
      imagem_url: '/mock-preview/burger-hero.jpg',
      categoria_id: 1,
      ordem_exibicao: 1,
      grupos_modificadores: [
        {
          id: 'g-ponto',
          nome: 'Ponto da carne',
          min_selecoes: 1,
          max_selecoes: 1,
          tipo: 'obrigatorio',
          opcoes: [
            { id: 'opt-ao-ponto', nome: 'Ao ponto (rosado e suculento)', preco_adicional: 0 },
            { id: 'opt-bem-passado', nome: 'Bem passado', preco_adicional: 0 },
            { id: 'opt-mal-passado', nome: 'Mal passado (crosta selada)', preco_adicional: 0 },
          ],
        },
        {
          id: 'g-extras',
          nome: 'Adicionais especiais',
          min_selecoes: 0,
          max_selecoes: 3,
          tipo: 'opcional',
          opcoes: [
            { id: 'opt-bacon', nome: 'Bacon artesanal crocante', preco_adicional: 4.5 },
            { id: 'opt-queijo-extra', nome: 'Cheddar inglês extra', preco_adicional: 3.5 },
            { id: 'opt-cebola-crispy', nome: 'Cebola crispy temperada', preco_adicional: 3.0 },
          ],
        },
      ],
    },
    { id: 990012, nome: 'Smash duplo KÔMA', descricao: 'Dois smashes 90g com crosta crocante, queijo prato duplo derretido e maionese defumada.', preco: 32.9, imagem_url: '/mock-preview/smash-duplo.jpg', categoria_id: 1, ordem_exibicao: 2, grupos_modificadores: [] },
    { id: 990013, nome: 'Combo da casa KÔMA', descricao: 'Burger artesanal, batata rústica crocante e bebida gelada à sua escolha.', preco: 44.9, imagem_url: '/mock-preview/drink-combo.jpg', categoria_id: 2, ordem_exibicao: 3, grupos_modificadores: [] },
    { id: 990014, nome: 'Batata rústica crocante', descricao: 'Porção individual de batatas rústicas com alecrim fresco e sal de parrilla.', preco: 18.5, imagem_url: '/mock-preview/porcao-fritas.jpg', categoria_id: 3, ordem_exibicao: 4, grupos_modificadores: [] },
    { id: 990015, nome: 'Molho especial da casa', descricao: 'Receita autoral à base de páprica defumada, ervas finas e mostarda dijon.', preco: 6.0, imagem_url: '', categoria_id: 3, ordem_exibicao: 5, grupos_modificadores: [] },
    { id: 990016, nome: 'Suco de Laranja Natural 400ml', descricao: 'Frutas frescas da estação espremidas na hora, servido bem gelado.', preco: 12.0, imagem_url: '/mock-preview/drink-combo.jpg', categoria_id: 4, ordem_exibicao: 6, grupos_modificadores: [] },
    { id: 990017, nome: 'Refrigerante Artesanal de Guaraná', descricao: 'Xarope natural de guaraná da Amazônia com gaseificação suave e toque cítrico.', preco: 9.5, imagem_url: '/mock-preview/drink-combo.jpg', categoria_id: 4, ordem_exibicao: 7, grupos_modificadores: [] },
    { id: 990018, nome: 'Pudim de Leite KÔMA', descricao: 'Textura acetinada sem furinhos com abundante caramelo de cumaru.', preco: 14.5, imagem_url: '/mock-preview/burger-hero.jpg', categoria_id: 5, ordem_exibicao: 8, grupos_modificadores: [] },
    { id: 990019, nome: 'Brownie artesanal com calda de chocolate', descricao: 'Cacau 70% com castanhas tostadas e calda morna aveludada.', preco: 17.0, imagem_url: '/mock-preview/smash-duplo.jpg', categoria_id: 5, ordem_exibicao: 9, grupos_modificadores: [] },
  ],
  promocoes: [
    {
      id: 'promo-combo-koma',
      nome: 'Combo Degustação KÔMA',
      descricao: 'Monte seu combo especial escolhendo 1 Burger artesanal acompanhado de Batatas Rústicas crocantes.',
      preco: 46.9,
      componentes: [
        [990011, 990012],
        [990014],
      ],
      fim_em: null,
    },
  ],
  produtos_promocionais: [],
};

const sendJson = (response, status, data) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
};

function handler(request, response) {
  const origin = request.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return sendJson(response, 403, { detail: 'Origem não autorizada na prévia local.' });
  }
  if (origin) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    return response.end();
  }
  // Deliberately reject checkout, authentication, payments and all writes.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return sendJson(response, 405, { detail: 'Prévia visual: pedidos e alterações estão desabilitados.' });
  }
  const url = new URL(request.url || '/', 'http://localhost:8000');
  if (url.pathname === '/api/cardapio-digital/public') {
    if (url.searchParams.get('slug') !== 'preview-ui') {
      return sendJson(response, 404, { detail: 'Prévia disponível somente em /c/preview-ui.' });
    }
    return sendJson(response, 200, payload);
  }
  if (url.pathname === '/api/cardapio-digital/populares' &&
      url.searchParams.get('restaurante_id') === String(RESTAURANT_ID)) {
    return sendJson(response, 200, { produtos: [
      { produto_id: '990011', escolhas: 9 },
      { produto_id: '990012', escolhas: 6 },
    ] });
  }
  if (url.pathname === '/health') {
    return sendJson(response, 200, { preview: true, mode: 'read-only' });
  }
  return sendJson(response, 404, { detail: 'Endpoint indisponível na prévia visual.' });
}

let listening = 0;
for (const host of HOSTS) {
  const server = createServer(handler);
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && host === '::1' && listening > 0) return;
    if (error.code === 'EADDRNOTAVAIL' && host === '::1' && listening > 0) return;
    console.error(`Prévia não iniciou em ${host}:`, error.message);
    if (listening === 0) process.exitCode = 1;
  });
  server.listen(PORT, host, () => {
    listening += 1;
    console.log(`Prévia visual (somente leitura): http://${host === '::1' ? '[::1]' : host}:${PORT}`);
    if (listening === 1) console.log('Abra http://localhost:3000/c/preview-ui — dados fictícios, sem pedidos reais.');
  });
}
