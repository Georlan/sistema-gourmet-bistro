/** Local-only visual review. Serves the real frontend; APIs never reach a restaurant. */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { mockTables, mockOrders, NOW } from './fixtures/waiterSalonPreview.mjs';
const port = Number(process.env.KOMA_WAITER_PREVIEW_PORT || 4294);
const vitePort = port + 1;
const origin = `http://127.0.0.1:${port}`;
const tables = [...mockTables, ...Array.from({ length: 24 }, (_, i) => ({ id: i + 7, nome: i === 0 ? 'Terraço fundos' : `Mesa ${i + 7}`, capacidade: 4, status: 'livre' }))];
const orders = structuredClone(mockOrders).map(order => ({ ...order, criado_em: new Date(Date.now() - (NOW.getTime() - new Date(order.criado_em).getTime())).toISOString() }));
const products = [{ id: 'prod-1', nome: 'Hambúrguer Gourmet', preco: 45, ativo: true, categoria_id: 'cat-1' }, { id: 'prod-2', nome: 'Porção Batata Frita', preco: 30, ativo: true, categoria_id: 'cat-1' }, { id: 'prod-3', nome: 'Pudim', preco: 25, ativo: true, categoria_id: 'cat-1' }];
// Local example for the approved repeat-from-consumption flow.
products.push({ id: 'preview-juice', nome: 'Suco de laranja', preco: 12, ativo: true, categoria_id: 'cat-1' });
orders[0].itens.push({ id: 'preview-juice-item', lancamento_id: 'launch-2-2', produto_id: 'preview-juice', preco_unit: 12, status: 'entregue', pago: false, cliente_nome: 'Consumo Geral', produto: { id: 'preview-juice', nome: 'Suco de laranja', preco: 12, ativo: true } });
// Persisted-identity fixtures for separate launch reprints and the full table receipt.
orders[0].numero_pedido = 111;
orders[0].lancamentos = ['launch-2-1', 'launch-2-2'].map(id => ({ id, comanda_id: orders[0].id, origem: 'garcom', timestamp: orders[0].criado_em }));
// Explicit fictional identities for the isolated preview only.
const previewHistoryNumbers = { 'launch-2-1': '111-A', 'launch-2-2': '111-B', 'launch-3-1': '103-A', 'launch-4-1': '104-A', 'launch-6-1': '106-A' };
const historyLaunches = order => (order.lancamentos || [...new Set(order.itens.map(item => item.lancamento_id))].filter(Boolean).map(id => ({ id }))).map(launch => ({ ...launch, display_number: previewHistoryNumbers[launch.id] || launch.display_number || null }));
const categories = [{ id: 'cat-1', nome: 'Cozinha', destino_impressao: 'COZINHA' }];
const bootstrap = `
const key='koma_operator_session_garcom';
if(!sessionStorage.getItem(key)) {
 sessionStorage.setItem(key,JSON.stringify({expiresAt:Date.now()+86400000,token:'local-preview-only',user:{id:'waiter-phase7',nome:'Ana',role:'garcom',restaurante_id:99001}}));
 sessionStorage.setItem('koma_waiter_token','local-preview-only');sessionStorage.setItem('koma_waiter_id','waiter-phase7');sessionStorage.setItem('koma_waiter_name','Ana');sessionStorage.setItem('koma_active_operational_portal','garcom');sessionStorage.setItem('koma_user_role','garcom');
}
if(!localStorage.getItem('@koma:theme'))localStorage.setItem('@koma:theme','dark');
if(!localStorage.getItem('koma_preview_seeded')){localStorage.setItem('koma_drafts_v4:99001:waiter-phase7',JSON.stringify({1:[{id:'preview-draft',produtoId:'prod-1',nome:'Hambúrguer Gourmet',preco:45,quantidade:1,observacao:'',clienteNome:'Consumo Geral'}]}));localStorage.setItem('koma_preview_seeded','1');}
if(new URLSearchParams(location.search).get('test')==='counter'&&!localStorage.getItem('koma_preview_counter_seeded')){
 const key='koma_drafts_v4:99001:waiter-phase7';const drafts=JSON.parse(localStorage.getItem(key)||'{}');
 drafts[10]=[{id:'counter-plain-joao',produtoId:'prod-1',nome:'Hambúrguer Gourmet',preco:45,quantidade:1,observacao:'',clienteNome:'João'},{id:'counter-custom-ana',produtoId:'prod-1',nome:'Hambúrguer Gourmet',preco:45,quantidade:1,observacao:'Sem cebola',clienteNome:'Ana'},{id:'counter-plain-ana',produtoId:'prod-1',nome:'Hambúrguer Gourmet',preco:45,quantidade:1,observacao:'',clienteNome:'Ana'}];
 localStorage.setItem(key,JSON.stringify(drafts));localStorage.setItem('koma_preview_counter_seeded','1');
}

`;
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (url.pathname === '/__preview/session.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(bootstrap); return; }
  if (url.pathname.startsWith('/__preview/api')) {
    const pathname = url.pathname.slice('/__preview/api'.length);
    if (pathname === '/api/support/feedback' && req.method !== 'GET') return json(res, { detail: 'Prévia local: nenhuma mensagem foi enviada ao suporte.' }, 422);
    if (req.method !== 'GET') { json(res, { detail: 'Prévia local: nenhuma alteração foi enviada. O rascunho permanece salvo neste navegador.' }, 422); return; }
    if (pathname === '/garcom/historico') {
      const entries = orders.flatMap(order => historyLaunches(order).map((launch, index) => ({ id: launch.id, pedido: launch.display_number || null, mesa_id: order.mesa_id, mesa_nome: tables.find(table => table.id === order.mesa_id)?.nome || `Mesa ${order.mesa_id}`, horario: order.criado_em, itens_count: order.itens.filter(item => item.lancamento_id === launch.id).length }))).sort((a,b) => b.horario.localeCompare(a.horario));
      return json(res, { dia: url.searchParams.get('dia'), items: entries.filter(entry => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Fortaleza' }).format(new Date(entry.horario)) === url.searchParams.get('dia')), next_cursor: null });
    }
    if (pathname.startsWith('/garcom/historico/')) {
      const id = decodeURIComponent(pathname.split('/').at(-1));const order = orders.find(order => historyLaunches(order).some(launch => launch.id === id));
      if (!order) return json(res, { detail: 'Pedido fictício não encontrado.' }, 404);
      const launch = historyLaunches(order).find(launch => launch.id === id);
      const items = order.itens.filter(item => item.lancamento_id === id).map(item => ({ id: item.id, nome: item.produto?.nome || products.find(product => product.id === item.produto_id)?.nome || 'Produto', preco: item.preco_unit, cliente: item.cliente_nome || '', observacao: item.observacao || '', status: item.status, modificadores: [] }));
      return json(res, { id, pedido: launch.display_number || null, mesa_id: order.mesa_id, mesa_nome: tables.find(table => table.id === order.mesa_id)?.nome || `Mesa ${order.mesa_id}`, horario: order.criado_em, itens_count: items.length, itens: items });
    }
    if (pathname === '/mesas/') return json(res, tables);
    if (pathname === '/comandas/detalhes/todos') return json(res, orders);
    if (pathname.startsWith('/comandas/check-')) return json(res, orders.find(order => order.id === pathname.split('/')[2]) || orders[0]);
    if (pathname.startsWith('/atendimentos/mesas/')) {
      const tableId = Number(pathname.split('/').at(-1));
      return json(res, { familias: orders.filter(order => order.mesa_id === tableId).map(order => ({ numero_conta: order.numero_pedido, lancamentos: historyLaunches(order).map((launch, index) => ({ lancamento_id: launch.id, pedido_id: previewHistoryNumbers[launch.id] || launch.display_number, sequencia: index + 1 })) })) });
    }
    if (pathname === '/produtos/catalogo') return json(res, { categorias: categories, produtos: products });
    if (pathname === '/produtos/categorias') return json(res, categories);
    if (pathname === '/caixa/configuracoes') return json(res, { perm_garcom_status: true, entitlements: { printing: true }, perm_garcom_print: true, perm_garcom_fechar: false, perm_garcom_editar: true, perm_garcom_cancelar: true, perm_garcom_transferir_mesa: true, perm_garcom_transferir_item: true, taxa_servico_ativa: false });
    if (pathname === '/caixa/pagamentos/pendentes') return json(res, []);
    return json(res, {});
  }
  try {
    const response = await fetch(`http://127.0.0.1:${vitePort}${req.url}`);
    let body = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') || 'application/octet-stream';
    if (type.includes('text/html')) body = Buffer.from(body.toString().replace('<head>', '<head><script src="/__preview/session.js"></script>'));
    res.writeHead(response.status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:${port}; worker-src 'self' blob:; frame-src 'self'` });
    res.end(body);
  } catch { res.writeHead(503, { 'Content-Type': 'text/plain', Refresh: '1' }); res.end('Preparando a prévia local…'); }
});
const sockets = new WebSocketServer({ server });
sockets.on('connection', socket => socket.on('message', () => {}));
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host=127.0.0.1', `--port=${vitePort}`, '--strictPort'], {
  stdio: 'inherit', env: { ...process.env, KOMA_E2E: 'true', DISABLE_HMR: 'true', VITE_API_URL: `${origin}/__preview/api`, VITE_WS_URL: `ws://127.0.0.1:${port}/__preview/ws` },
});
server.listen(port, '127.0.0.1', () => console.log(`Prévia isolada: ${origin}/?view=garcom`));
const shutdown = () => { vite.kill('SIGTERM'); sockets.close(); server.close(); process.exit(); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); vite.on('exit', () => { server.close(); });
