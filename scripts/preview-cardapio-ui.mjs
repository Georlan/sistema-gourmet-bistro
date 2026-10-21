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
    delivery_ativo: false,
    tipos_pedido_ativos: ['retirada'],
    formas_pagamento_aceitas: ['Dinheiro'],
    beneficios: { coupons: false, loyalty: false, cashback: false },
    pagamento_online_ativo: false,
    conta_cliente_obrigatoria: false,
    logo_url: '',
    banner_url: '',
  },
  categorias: [
    { id: 1, nome: 'Burgers' },
    { id: 2, nome: 'Combos' },
    { id: 3, nome: 'Porções' },
  ],
  produtos: [
    { id: 990011, nome: 'Burger clássico artesanal', descricao: 'Blend 160g grelhado no fogo, cheddar cremoso, cebola caramelizada e pão brioche selado na manteiga.', preco: 34.9, imagem_url: '/mock-preview/burger-hero.jpg', categoria_id: 1, ordem_exibicao: 1, grupos_modificadores: [] },
    { id: 990012, nome: 'Smash duplo KÔMA', descricao: 'Dois smashes 90g com crosta crocante, queijo prato duplo derretido e maionese defumada.', preco: 32.9, imagem_url: '/mock-preview/smash-duplo.jpg', categoria_id: 1, ordem_exibicao: 2, grupos_modificadores: [] },
    { id: 990013, nome: 'Combo da casa KÔMA', descricao: 'Burger artesanal, batata rústica crocante e bebida gelada à sua escolha.', preco: 44.9, imagem_url: '/mock-preview/drink-combo.jpg', categoria_id: 2, ordem_exibicao: 3, grupos_modificadores: [] },
    { id: 990014, nome: 'Batata rústica crocante', descricao: 'Porção individual de batatas rústicas com alecrim fresco e sal de parrilla.', preco: 18.5, imagem_url: '/mock-preview/porcao-fritas.jpg', categoria_id: 3, ordem_exibicao: 4, grupos_modificadores: [] },
    { id: 990015, nome: 'Molho especial da casa', descricao: 'Receita autoral à base de páprica defumada, ervas finas e mostarda dijon.', preco: 6.0, imagem_url: '', categoria_id: 3, ordem_exibicao: 5, grupos_modificadores: [] },
  ],
  promocoes: [],
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
