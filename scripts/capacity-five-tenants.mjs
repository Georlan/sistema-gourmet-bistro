#!/usr/bin/env node
// Operational load gate. Intentionally refuses production and requires five
// separately provisioned QA identities; no credentials are committed.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HOMOLOGATION_HOST = 'koma-production-3b05.up.railway.app';
const requiredHost = (process.env.KOMA_CAPACITY_ALLOW_HOST || HOMOLOGATION_HOST).trim().toLowerCase();
const base = new URL(process.env.KOMA_CAPACITY_API_URL || `https://${HOMOLOGATION_HOST}`);
const host = base.hostname.toLowerCase();
if (!requiredHost || host !== requiredHost || host !== HOMOLOGATION_HOST) {
  throw new Error('Capacity gate requires the explicitly allowed Railway homologation host');
}
const password = readFileSync(process.env.KOMA_CAPACITY_PASSWORD_FILE || '', 'utf8').trim();
if (password.length < 12) throw new Error('QA password file is missing or invalid');

function provisionTenants() {
  const source = readFileSync(fileURLToPath(new URL('../backend/tools/provision_capacity_tenants.py', import.meta.url)));
  const bootstrap = 'import sys,base64; code=base64.b64decode(sys.stdin.readline()); CAPACITY_PASSWORD=sys.stdin.readline().strip(); exec(code, {"__name__":"__main__", "CAPACITY_PASSWORD":CAPACITY_PASSWORD})';
  const runner = spawnSync('railway', [
    'ssh', '-p', '6aca32bc-4b1e-4499-a014-dd14791341bb',
    '-e', 'b8cb3831-25f3-4697-81af-29e35f595b81',
    '-s', '615adbd7-17e9-4f5e-b455-0d1e9edb750d',
    'python', '-c', bootstrap,
  ], { input: `${source.toString('base64')}\n${password}\n`, encoding: 'utf8', timeout: 60000 });
  if (runner.status !== 0) throw new Error(`QA provisioning failed: ${(runner.stderr || '').slice(0, 300)}`);
  const output = runner.stdout.trim().split('\n').at(-1);
  return JSON.parse(output);
}
const tenants = process.env.KOMA_CAPACITY_TENANTS_FILE
  ? JSON.parse(readFileSync(process.env.KOMA_CAPACITY_TENANTS_FILE, 'utf8'))
  : provisionTenants();
if (!Array.isArray(tenants) || tenants.length < 5 ||
    new Set(tenants.map(t => t.restaurante_id)).size !== tenants.length ||
    tenants.some(t => !/^capacity-qa-[1-9]\d*@koma\.test$/.test(t.email) || !Number.isInteger(t.restaurante_id))) {
  throw new Error('Expected at least five distinct capacity QA tenants');
}
const rounds = Number(process.env.KOMA_CAPACITY_ORDERS_PER_TENANT || 4);
const timeout = Number(process.env.KOMA_CAPACITY_TIMEOUT_MS || 5000);
const p95Limit = Number(process.env.KOMA_CAPACITY_P95_LIMIT_MS || 2000);
const expectedReplicas = Number(process.env.KOMA_CAPACITY_EXPECT_REPLICAS || 1);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20 || timeout < 1000 || p95Limit < 100) {
  throw new Error('Invalid load limits');
}
if (!Number.isInteger(expectedReplicas) || expectedReplicas < 1 || expectedReplicas > 2) {
  throw new Error('Invalid expected replica count');
}

const results = [];
const started = performance.now();
function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}
async function call(name, path, { method = 'GET', token, body, expected = [200], headers = {}, onResponse } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const began = performance.now();
  let recorded = false;
  try {
    const response = await fetch(new URL(path, base), {
      method, signal: controller.signal, redirect: 'error',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = raw; }
    const elapsed = performance.now() - began;
    onResponse?.(response.headers.get('x-koma-instance'));
    results.push({ name, status: response.status, ms: elapsed, expected: expected.includes(response.status),
      instance: response.headers.get('x-koma-instance') });
    recorded = true;
    if (!expected.includes(response.status)) throw new Error(`${name}: HTTP ${response.status} ${raw.slice(0, 200)}`);
    return data;
  } catch (error) {
    if (!recorded) {
      results.push({ name, status: 0, ms: performance.now() - began, expected: false,
        timeout: error?.name === 'AbortError' });
    }
    throw error;
  } finally { clearTimeout(timer); }
}

const context = [];
for (const tenant of tenants) {
  const login = await call('login', '/auth/login', {
    method: 'POST', body: { username: tenant.email, password, restaurante_id: tenant.restaurante_id },
  });
  if (login.user?.restaurante_id !== tenant.restaurante_id &&
      login.usuario?.restaurante_id !== tenant.restaurante_id) {
    throw new Error(`Login identity mismatch for ${tenant.email}`);
  }
  const stock = await call('stock.before', '/estoque/insumos', { token: login.access_token });
  const stockId = `capacity-stock-${tenant.email.match(/capacity-qa-(\d+)/)[1]}`;
  const ownStock = stock.find(item => item.id === stockId);
  if (!ownStock || stock.some(item => item.id.startsWith('capacity-stock-') && item.id !== stockId)) {
    throw new Error(`Stock isolation failed for ${tenant.email}`);
  }
  context.push({ ...tenant, token: login.access_token, ids: [], stockId,
    stockBefore: ownStock.estoque_atual, userId: login.usuario.id });
}

const sockets = await Promise.all(context.map(async ctx => {
  const url = `wss://${HOMOLOGATION_HOST}/ws/${ctx.userId}`;
  const socket = new WebSocket(url, ['koma-auth', ctx.token], {
    origin: 'https://app.komafood.com.br',
  });
  ctx.realtimeEvents = [];
  ctx.operationalEvents = [];
  ctx.orderInstances = new Set();
  socket.on('upgrade', response => { ctx.websocketInstance = response.headers['x-koma-instance']; });
  socket.on('message', raw => {
    try {
      const event = JSON.parse(String(raw));
      if (event.event === 'draft_status' && Number(event.mesa_id) >= 50000) {
        ctx.realtimeEvents.push(event);
      }
      if (event.event === 'tables_updated') ctx.operationalEvents.push(event);
    } catch { /* Other operational events are not part of this probe. */ }
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket connection timed out for ${ctx.restaurante_id}`)), timeout);
    socket.once('open', () => { clearTimeout(timer); resolve(); });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
  return socket;
}));
for (const [index, ctx] of context.entries()) {
  sockets[index].send(JSON.stringify({ action: 'draft_status', mesa_id: 50000 + ctx.restaurante_id, ativo: true }));
}
const realtimeDeadline = performance.now() + Math.min(timeout, 3000);
while (context.some(ctx => ctx.realtimeEvents.length < 1) && performance.now() < realtimeDeadline) {
  await new Promise(resolve => setTimeout(resolve, 50));
}
await new Promise(resolve => setTimeout(resolve, 300));
for (const ctx of context) {
  if (ctx.realtimeEvents.length !== 1 ||
      ctx.realtimeEvents[0].mesa_id !== 50000 + ctx.restaurante_id) {
    throw new Error(`Realtime tenant isolation failed for ${ctx.restaurante_id}`);
  }
}

const runId = randomUUID();
async function oneOrder(ctx, index) {
  const key = `capacity-${runId}-${ctx.restaurante_id}-${index}`;
  const body = { tipo: 'Balcão', identificador: 'Balcão', idempotency_key: key,
    itens: [{ produto_id: 'capacity-product' }] };
  const options = { method: 'POST', token: ctx.token, body, expected: [201],
    headers: { 'X-Idempotency-Key': key },
    onResponse: instance => { if (instance) ctx.orderInstances.add(instance); } };
  const [first, repeated] = await Promise.all([
    call('order.create', '/comandas/venda-direta', options),
    call('order.retry', '/comandas/venda-direta', options),
  ]);
  if (!first.id || first.id !== repeated.id) {
    throw new Error(`Duplicate intent produced different orders for tenant ${ctx.restaurante_id}`);
  }
  ctx.ids.push(first.id);
}

await Promise.all(context.map(async ctx => {
  for (let index = 0; index < rounds; index += 1) {
    await call('config', '/caixa/configuracoes', { token: ctx.token });
    await call('categories', '/produtos/categorias', { token: ctx.token });
    await call('shift', '/caixa/turno-atual/resumo', { token: ctx.token });
    await call('delivery', '/comandas/delivery/ativos', { token: ctx.token });
    await oneOrder(ctx, index);
  }
}));

for (const ctx of context) {
  const detail = await call('order.detail', `/comandas/${ctx.ids[0]}`, { token: ctx.token });
  const itemId = detail.itens?.[0]?.id;
  if (!itemId) throw new Error(`Order has no item for tenant ${ctx.restaurante_id}`);
  const paymentKey = `capacity-pay-${runId}-${ctx.restaurante_id}`;
  const paymentOptions = { method: 'POST', token: ctx.token, expected: [201],
    body: { valor: 10, metodo: 'dinheiro', idempotency_key: paymentKey } };
  const [payment, paymentRetry] = await Promise.all([
    call('payment.create', `/caixa/comandas/${ctx.ids[0]}/pagar`, paymentOptions),
    call('payment.retry', `/caixa/comandas/${ctx.ids[0]}/pagar`, paymentOptions),
  ]);
  if (!payment.id || payment.id !== paymentRetry.id) {
    throw new Error(`Payment intention duplicated for ${ctx.restaurante_id}`);
  }
  const shiftDetail = await call('shift.payments', '/caixa/turno/atual', { token: ctx.token });
  if (shiftDetail.pagamentos?.filter(entry => entry.id === payment.id).length !== 1) {
    throw new Error(`Payment was not recorded exactly once for ${ctx.restaurante_id}`);
  }
  await call('kitchen.preparing', `/comandas/itens/${itemId}/status?status=preparando`, {
    method: 'PUT', token: ctx.token,
  });
  const ready = await call('kitchen.ready', `/comandas/itens/${itemId}/status?status=pronto`, {
    method: 'PUT', token: ctx.token,
  });
  if (ready.status !== 'pronto') throw new Error(`Kitchen state not persisted for ${ctx.restaurante_id}`);
  const stock = await call('stock.after', '/estoque/insumos', { token: ctx.token });
  const ownStock = stock.find(item => item.id === ctx.stockId);
  if (!ownStock || ownStock.estoque_atual !== ctx.stockBefore - rounds ||
      stock.some(item => item.id.startsWith('capacity-stock-') && item.id !== ctx.stockId)) {
    throw new Error(`Stock count or isolation failed for ${ctx.restaurante_id}`);
  }
  const listed = await call('orders.list', '/comandas/', { token: ctx.token });
  for (const id of ctx.ids) {
    if (listed.filter(order => order.id === id).length !== 1) {
      throw new Error(`Order ${id} missing or duplicated in tenant ${ctx.restaurante_id}`);
    }
  }
  for (const other of context) {
    if (other === ctx) continue;
    if (other.ids.some(id => listed.some(order => order.id === id))) {
      throw new Error(`Cross-tenant order leak into ${ctx.restaurante_id}`);
    }
    await call('cross-tenant.deny', `/comandas/${other.ids[0]}`, {
      token: ctx.token, expected: [403, 404],
    });
  }
}
if (expectedReplicas === 2 && !context.some(ctx =>
  ctx.websocketInstance && ctx.operationalEvents.length > 0 &&
  [...ctx.orderInstances].some(instance => instance !== ctx.websocketInstance))) {
  throw new Error('No operational event was observed across two distinct backend instances');
}
for (const socket of sockets) socket.close();

const duration = (performance.now() - started) / 1000;
const latencies = results.filter(r => r.expected).map(r => r.ms);
const instances = [...new Set(results.map(r => r.instance).filter(Boolean))].sort();
const metrics = {
  tenants: context.length, orders: context.length * rounds, operations: results.length,
  concurrency: context.length * 2,
  duration_s: Number(duration.toFixed(2)), rps: Number((results.length / duration).toFixed(2)),
  p50_ms: Math.round(percentile(latencies, .5)), p95_ms: Math.round(percentile(latencies, .95)),
  p99_ms: Math.round(percentile(latencies, .99)), max_ms: Math.round(Math.max(...latencies)),
  status_2xx: results.filter(r => r.status >= 200 && r.status < 300).length,
  expected_4xx: results.filter(r => r.status >= 400 && r.status < 500 && r.expected).length,
  status_5xx: results.filter(r => r.status >= 500).length,
  timeouts: results.filter(r => r.timeout).length,
  isolation_failures: 0,
  idempotency_failures: 0,
  payment_failures: 0,
  stock_failures: 0,
  realtime_failures: 0,
  realtime_connections: sockets.length,
  instances,
  websocket_instances: [...new Set(context.map(ctx => ctx.websocketInstance).filter(Boolean))].sort(),
  cross_replica_realtime_tenants: context.filter(ctx => ctx.websocketInstance && ctx.operationalEvents.length > 0 &&
    [...ctx.orderInstances].some(instance => instance !== ctx.websocketInstance)).length,
};
metrics.by_operation = Object.fromEntries([...new Set(results.map(r => r.name))].map(name => {
  const operation = results.filter(r => r.name === name);
  return [name, { count: operation.length, p95_ms: Math.round(percentile(operation.map(r => r.ms), .95)),
    errors: operation.filter(r => !r.expected).length }];
}));
console.log(JSON.stringify(metrics, null, 2));
if (instances.length < expectedReplicas || metrics.p95_ms > p95Limit || results.some(r => !r.expected)) {
  throw new Error('Capacity gate failed latency or HTTP criteria');
}
