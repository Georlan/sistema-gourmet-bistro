#!/usr/bin/env node

const DEFAULT_CONCURRENCY = 10;
const DEFAULT_REQUESTS_PER_WORKER = 12;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_P95_LIMIT_MS = 2000;

const READ_ONLY_PATHS = [
  '/health/ready',
  '/caixa/configuracoes',
  '/caixa/turno-atual/resumo',
  '/comandas/delivery/ativos',
  '/produtos/categorias',
];

function positiveInt(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} deve ser um número positivo`);
  }
  return Math.floor(value);
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

function assertNonProductionTarget(url) {
  const host = url.hostname.toLowerCase();
  const forbidden = [
    'sistema-gourmet-bistro-production.up.railway.app',
    'sistema-gourmet-bistro.pages.dev',
  ];
  if (forbidden.some(value => host === value || host.endsWith(`.${value}`))) {
    throw new Error('Capacity smoke bloqueado contra produção. Use somente homologação.');
  }

  const allowedHint = (process.env.KOMA_CAPACITY_ALLOW_HOST || '').trim().toLowerCase();
  if (!allowedHint) {
    throw new Error(
      'Defina KOMA_CAPACITY_ALLOW_HOST explicitamente para o hostname de homologação.',
    );
  }
  if (host !== allowedHint) {
    throw new Error(
      `Host ${host} difere de KOMA_CAPACITY_ALLOW_HOST=${allowedHint}`,
    );
  }
}

function parseTokens() {
  return (process.env.KOMA_CAPACITY_TOKENS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

async function resolveTokens(baseUrl, timeoutMs) {
  const configuredTokens = parseTokens();
  if (configuredTokens.length) return configuredTokens;

  const username = (process.env.KOMA_CAPACITY_LOGIN_EMAIL || '').trim();
  const password = process.env.KOMA_CAPACITY_LOGIN_PASSWORD || '';
  const restaurantIdRaw = (process.env.KOMA_CAPACITY_LOGIN_RESTAURANT_ID || '').trim();

  if (!username && !password && !restaurantIdRaw) return [];
  if (!username || !password) {
    throw new Error(
      'Defina KOMA_CAPACITY_LOGIN_EMAIL e KOMA_CAPACITY_LOGIN_PASSWORD juntos.',
    );
  }

  let restaurantId;
  if (restaurantIdRaw) {
    restaurantId = Number(restaurantIdRaw);
    if (!Number.isInteger(restaurantId) || restaurantId <= 0) {
      throw new Error('KOMA_CAPACITY_LOGIN_RESTAURANT_ID deve ser um inteiro positivo.');
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        ...(restaurantId ? { restaurante_id: restaurantId } : {}),
      }),
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Login QA falhou com HTTP ${response.status}`);
    }
    const payload = await response.json();
    const token = String(payload?.access_token || '').trim();
    if (!token) {
      throw new Error('Login QA não retornou access_token.');
    }
    return [token];
  } finally {
    clearTimeout(timer);
  }
}

async function request(baseUrl, path, token, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: controller.signal,
      redirect: 'error',
    });
    const elapsedMs = performance.now() - started;
    await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      elapsedMs,
      path,
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsedMs: performance.now() - started,
      path,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const rawUrl = (process.env.KOMA_CAPACITY_API_URL || '').trim();
  if (!rawUrl) {
    throw new Error('Defina KOMA_CAPACITY_API_URL para o backend de homologação.');
  }
  const url = new URL(rawUrl);
  assertNonProductionTarget(url);
  const baseUrl = url.toString().replace(/\/$/, '');

  const concurrency = positiveInt('KOMA_CAPACITY_CONCURRENCY', DEFAULT_CONCURRENCY);
  const requestsPerWorker = positiveInt(
    'KOMA_CAPACITY_REQUESTS_PER_WORKER',
    DEFAULT_REQUESTS_PER_WORKER,
  );
  const timeoutMs = positiveInt('KOMA_CAPACITY_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const p95LimitMs = positiveInt('KOMA_CAPACITY_P95_LIMIT_MS', DEFAULT_P95_LIMIT_MS);
  const tokens = await resolveTokens(baseUrl, timeoutMs);

  console.log('KÔMA capacity smoke — READ ONLY / HOMOLOGAÇÃO');
  console.log(`API: ${baseUrl}`);
  console.log(
    `Workers: ${concurrency}; requests/worker: ${requestsPerWorker}; tokens: ${tokens.length || 0}`,
  );

  const results = [];
  await Promise.all(
    Array.from({ length: concurrency }, async (_, workerIndex) => {
      const token = tokens.length ? tokens[workerIndex % tokens.length] : '';
      for (let i = 0; i < requestsPerWorker; i += 1) {
        const path = READ_ONLY_PATHS[(workerIndex + i) % READ_ONLY_PATHS.length];
        results.push(await request(baseUrl, path, token, timeoutMs));
      }
    }),
  );

  const failures = results.filter(item => !item.ok);
  const latencies = results.map(item => item.elapsedMs);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);

  const byPath = new Map();
  for (const item of results) {
    const bucket = byPath.get(item.path) || [];
    bucket.push(item);
    byPath.set(item.path, bucket);
  }

  console.log(
    `Total=${results.length} falhas=${failures.length} p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms`,
  );
  for (const [path, items] of byPath.entries()) {
    const pathLatencies = items.map(item => item.elapsedMs);
    const pathFailures = items.filter(item => !item.ok);
    console.log(
      `${path}: n=${items.length} falhas=${pathFailures.length} p95=${percentile(pathLatencies, 0.95).toFixed(0)}ms`,
    );
  }

  if (failures.length) {
    const sample = failures.slice(0, 8).map(item => ({
      path: item.path,
      status: item.status,
      error: item.error,
      elapsedMs: Math.round(item.elapsedMs),
    }));
    console.error('Falhas:', JSON.stringify(sample, null, 2));
    process.exitCode = 1;
    return;
  }

  if (p95 > p95LimitMs) {
    console.error(
      `p95 ${p95.toFixed(0)}ms excede o limite ${p95LimitMs}ms (KOMA_CAPACITY_P95_LIMIT_MS)`,
    );
    process.exitCode = 1;
    return;
  }

  console.log('PASS — sem erro/timeout e p95 dentro do limite configurado.');
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
