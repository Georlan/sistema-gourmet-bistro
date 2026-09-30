#!/usr/bin/env node

const DEFAULT_FRONTEND_URL = 'https://app.komafood.com.br';
const DEFAULT_CENTRAL_URL = 'https://central.komafood.com.br';
const DEFAULT_API_URL = 'https://sistema-gourmet-bistro-production.up.railway.app';
const DEFAULT_CORS_PATH = '/cardapio/pedidos';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DEPLOY_WAIT_MS = 5 * 60_000;
const CONTRACT_PATHS = ['/contratar/pocket', '/contratar/pro', '/contratar/premium'];

function normalizeBaseUrl(value, fallback) {
  const raw = (value || fallback).trim();
  const url = new URL(raw);
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function originOf(url) {
  return new URL(url).origin;
}

function splitHeader(value) {
  return (value || '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function hasCorsValue(actual, expected) {
  const values = splitHeader(actual);
  return values.includes('*') || values.includes(expected.toLowerCase());
}

async function request(url, options = {}, retries = 2) {
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const controller = new AbortController();
    const timeoutMs = Number(process.env.KOMA_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        redirect: 'follow',
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt <= retries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const cause = error && typeof error === 'object' && 'cause' in error && error.cause
        ? ` [cause: ${error.cause}]`
        : '';
      throw new Error(`fetch failed for ${url}${cause}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function assertOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
  }
}

async function checkHtml(url, label) {
  const response = await request(url, { method: 'GET' });
  assertOk(response, label);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(`${label}: content-type inesperado: ${contentType || '(ausente)'}`);
  }
  console.log(`✓ ${label} ${response.status} — ${url}`);
}

async function waitForFrontendDeployment(frontendUrl, expectedSha) {
  if (!expectedSha) return;

  const expected = expectedSha.slice(0, 12);
  const waitMs = Number(process.env.KOMA_FRONTEND_DEPLOY_WAIT_MS || DEFAULT_DEPLOY_WAIT_MS);
  const deadline = Date.now() + waitMs;
  let lastSeen = 'indisponível';

  while (Date.now() < deadline) {
    try {
      const metaUrl = `${frontendUrl}/meta.json?probe=${Date.now()}`;
      const response = await request(metaUrl, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
      }, 0);
      if (response.ok) {
        const payload = await response.json();
        lastSeen = String(payload?.sha || 'ausente');
        if (lastSeen === expected) {
          console.log(`✓ Frontend deploy ativo — ${expected}`);
          return;
        }
      }
    } catch {
      // Cloudflare may still be switching deployments. Retry until the deadline.
    }
    await new Promise(resolve => setTimeout(resolve, 10_000));
  }

  throw new Error(
    `Frontend deploy: commit esperado ${expected} não ficou ativo a tempo (último observado: ${lastSeen})`,
  );
}

async function checkApiReadiness(apiUrl) {
  const liveUrl = `${apiUrl}/health/live`;
  const liveResponse = await request(liveUrl, { method: 'GET' });
  assertOk(liveResponse, 'Backend liveness');
  console.log(`✓ Backend liveness ${liveResponse.status} — ${liveUrl}`);

  const readyUrl = `${apiUrl}/health/ready`;
  const response = await request(readyUrl, { method: 'GET' });
  assertOk(response, 'Backend readiness');
  const body = await response.text();
  console.log(`✓ Backend readiness ${response.status} — ${readyUrl}${body ? ` — ${body.slice(0, 180)}` : ''}`);
}

async function checkContractReadiness(apiUrl, expectedApiSha) {
  const url = `${apiUrl}/api/contracts/readiness`;
  const response = await request(url, { method: 'GET' });
  assertOk(response, 'Contract readiness');

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Contract readiness: resposta não é JSON válido');
  }

  if (payload?.ready !== true || payload?.providerIdentityConfigured !== true) {
    throw new Error('Contract readiness: identidade jurídica do prestador não está pronta para emitir comprovantes');
  }
  if (typeof payload?.legalVersion !== 'string' || !payload.legalVersion.trim()) {
    throw new Error('Contract readiness: versão jurídica vigente não foi informada');
  }
  if (expectedApiSha && payload?.deploymentGitSha !== expectedApiSha) {
    const actual = typeof payload?.deploymentGitSha === 'string' && payload.deploymentGitSha
      ? payload.deploymentGitSha.slice(0, 12)
      : 'ausente';
    throw new Error(
      `Contract readiness: deploy ainda não corresponde ao commit esperado ${expectedApiSha.slice(0, 12)} (atual: ${actual})`,
    );
  }

  const deploySuffix = expectedApiSha ? ` — deploy ${expectedApiSha.slice(0, 12)}` : '';
  console.log(`✓ Contract readiness ${response.status} — Legal v${payload.legalVersion} — identidade jurídica configurada${deploySuffix}`);
}

async function checkFrontend(frontendUrl) {
  const response = await request(frontendUrl, { method: 'GET' });
  assertOk(response, 'Frontend HTML');
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) {
    throw new Error(`Frontend: content-type inesperado: ${contentType || '(ausente)'}`);
  }
  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  if (!cacheControl.includes('no-store') && !cacheControl.includes('no-cache')) {
    throw new Error(`Frontend HTML: cache-control inseguro para version skew: ${cacheControl || '(ausente)'}`);
  }

  const html = await response.text();
  console.log(`✓ Frontend shell ${response.status} — ${frontendUrl}`);

  const scriptRegex = /<script\b[^>]*src=["']([^"']+\.js)["']/gi;
  const linkCssRegex = /<link\b[^>]*href=["']([^"']+\.css)["']/gi;
  const assets = new Set();
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    if (match[1].startsWith('/assets/')) assets.add(match[1]);
  }
  while ((match = linkCssRegex.exec(html)) !== null) {
    if (match[1].startsWith('/assets/')) assets.add(match[1]);
  }

  if (assets.size === 0) {
    throw new Error('Frontend: nenhum asset hashed (/assets/*) encontrado no HTML inicial.');
  }

  for (const assetPath of assets) {
    const assetUrl = `${frontendUrl}${assetPath}`;
    const assetRes = await request(assetUrl, { method: 'GET' });
    assertOk(assetRes, `Asset ${assetPath}`);
    const type = (assetRes.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) {
      throw new Error(`Asset ${assetPath}: retornou text/html; possível fallback SPA/version skew.`);
    }
    if (assetPath.endsWith('.js') && !type.includes('javascript')) {
      throw new Error(`Asset ${assetPath}: esperado JavaScript, recebido ${type || '(ausente)'}`);
    }
    if (assetPath.endsWith('.css') && !type.includes('text/css')) {
      throw new Error(`Asset ${assetPath}: esperado CSS, recebido ${type || '(ausente)'}`);
    }
    console.log(`✓ Asset íntegro [${type.split(';')[0]}] — ${assetPath}`);
  }

  const fakeAssetUrl = `${frontendUrl}/assets/__koma_skew_test_nonexistent__.js?probe=${Date.now()}`;
  const fakeRes = await request(fakeAssetUrl, {
    method: 'GET',
    headers: { 'Cache-Control': 'no-cache' },
  });
  const fakeType = (fakeRes.headers.get('content-type') || '').toLowerCase();
  const fakeCache = (fakeRes.headers.get('cache-control') || '').toLowerCase();

  if (fakeRes.status !== 404) {
    throw new Error(
      `Asset inexistente deve retornar 404 real; recebeu ${fakeRes.status} (${fakeType || 'sem content-type'})`,
    );
  }
  if (fakeType.includes('text/html')) {
    throw new Error('Asset inexistente retornou HTML; fallback SPA ainda está mascarando o 404.');
  }
  if (!fakeCache.includes('no-store')) {
    throw new Error(`Asset inexistente deve ser no-store; recebeu ${fakeCache || '(ausente)'}`);
  }
  console.log('✓ Asset inexistente retorna 404 real + no-store');
}

async function checkContractPages(frontendUrl) {
  for (const path of CONTRACT_PATHS) {
    await checkHtml(`${frontendUrl}${path}`, `Contratação ${path.split('/').at(-1)}`);
  }
}

async function checkCheckoutCors(apiUrl, frontendUrl, corsPath) {
  const origin = originOf(frontendUrl);
  const url = `${apiUrl}${corsPath.startsWith('/') ? corsPath : `/${corsPath}`}`;
  const response = await request(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-idempotency-key',
    },
  });

  assertOk(response, 'Checkout CORS preflight');

  const allowOrigin = response.headers.get('access-control-allow-origin');
  const allowMethods = response.headers.get('access-control-allow-methods');
  const allowHeaders = response.headers.get('access-control-allow-headers');

  if (allowOrigin !== origin) {
    throw new Error(`Checkout CORS preflight: allow-origin esperado ${origin}, recebido ${allowOrigin || '(ausente)'}`);
  }
  if (!hasCorsValue(allowMethods, 'post')) {
    throw new Error(`Checkout CORS preflight: POST ausente em access-control-allow-methods (${allowMethods || 'ausente'})`);
  }
  for (const header of ['content-type', 'x-idempotency-key']) {
    if (!hasCorsValue(allowHeaders, header)) {
      throw new Error(`Checkout CORS preflight: ${header} ausente em access-control-allow-headers (${allowHeaders || 'ausente'})`);
    }
  }

  console.log(`✓ Checkout CORS preflight ${response.status} — origin=${origin} — headers content-type + x-idempotency-key`);
}

async function main() {
  const frontendUrl = normalizeBaseUrl(process.env.KOMA_FRONTEND_URL, DEFAULT_FRONTEND_URL);
  const centralUrl = normalizeBaseUrl(process.env.KOMA_CENTRAL_URL, DEFAULT_CENTRAL_URL);
  const apiUrl = normalizeBaseUrl(process.env.KOMA_API_URL, DEFAULT_API_URL);
  const corsPath = (process.env.KOMA_CORS_PATH || DEFAULT_CORS_PATH).trim();
  const expectedApiSha = (process.env.KOMA_EXPECTED_API_SHA || '').trim();
  const expectedFrontendSha = (process.env.KOMA_EXPECTED_FRONTEND_SHA || '').trim();

  console.log('KÔMA production smoke (somente GET/OPTIONS; nenhuma mutação)');
  console.log(`Frontend: ${frontendUrl}`);
  console.log(`API: ${apiUrl}`);

  await waitForFrontendDeployment(frontendUrl, expectedFrontendSha);
  await checkApiReadiness(apiUrl);
  await checkContractReadiness(apiUrl, expectedApiSha);
  await checkFrontend(frontendUrl);
  await checkHtml(centralUrl, 'SuperAdmin público');
  await checkContractPages(frontendUrl);
  await checkCheckoutCors(apiUrl, frontendUrl, corsPath);

  console.log('✓ Smoke de produção concluído sem falhas.');
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ Smoke de produção falhou: ${message}`);
  process.exitCode = 1;
});
