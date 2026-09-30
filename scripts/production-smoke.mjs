#!/usr/bin/env node

const DEFAULT_FRONTEND_URL = 'https://app.komafood.com.br';
const DEFAULT_CENTRAL_URL = 'https://central.komafood.com.br';
const DEFAULT_API_URL = 'https://sistema-gourmet-bistro-production.up.railway.app';
const DEFAULT_CORS_PATH = '/cardapio/pedidos';
const DEFAULT_TIMEOUT_MS = 15_000;
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
    } catch (err) {
      if (attempt <= retries) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      const cause = err && typeof err === 'object' && 'cause' in err && err.cause ? ` [cause: ${err.cause}]` : '';
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

async function checkApiReadiness(apiUrl) {
  const liveUrl = `${apiUrl}/health/live`;
  const liveResponse = await request(liveUrl, { method: 'GET' });
  assertOk(liveResponse, 'Backend liveness');
  console.log(`✓ Backend liveness ${liveResponse.status} — ${liveUrl}`);
  const url = `${apiUrl}/health/ready`;
  const response = await request(url, { method: 'GET' });
  assertOk(response, 'Backend readiness');
  const body = await response.text();
  console.log(`✓ Backend readiness ${response.status} — ${url}${body ? ` — ${body.slice(0, 180)}` : ''}`);
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
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(`Frontend: content-type inesperado: ${contentType || '(ausente)'}`);
  }
  const html = await response.text();
  console.log(`✓ Frontend shell ${response.status} — ${frontendUrl}`);

  // 1. Extrair e verificar integridade de todos os assets hashed do HTML
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
    throw new Error(`Frontend: nenhum asset hashed (/assets/*) encontrado no HTML inicial.`);
  }

  for (const assetPath of assets) {
    const assetUrl = `${frontendUrl}${assetPath}`;
    const assetRes = await request(assetUrl, { method: 'GET' });
    assertOk(assetRes, `Asset ${assetPath}`);
    const ct = (assetRes.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('text/html')) {
      throw new Error(`Asset ${assetPath}: retornou text/html (mascarando asset perdido via fallback SPA)!`);
    }
    if (assetPath.endsWith('.js') && !ct.includes('javascript')) {
      throw new Error(`Asset ${assetPath}: esperado JavaScript, recebido ${ct}`);
    }
    if (assetPath.endsWith('.css') && !ct.includes('text/css')) {
      throw new Error(`Asset ${assetPath}: esperado CSS, recebido ${ct}`);
    }
    console.log(`✓ Asset íntegro [${ct.split(';')[0]}] — ${assetPath}`);
  }

  // 2. Testar que asset inexistente em /assets/* não mascara 404 como 200 HTML
  const fakeAssetUrl = `${frontendUrl}/assets/__koma_skew_test_nonexistent__.js`;
  const fakeRes = await request(fakeAssetUrl, { method: 'GET' });
  const fakeCt = (fakeRes.headers.get('content-type') || '').toLowerCase();
  const requireStrict404 = process.env.KOMA_REQUIRE_ASSET_404 === 'true';

  if (fakeRes.status === 200 && fakeCt.includes('text/html')) {
    const msg = `Alerta de version skew: ${fakeAssetUrl} retornou 200 text/html (SPA fallback mascara assets perdidos no deploy).`;
    if (requireStrict404) {
      throw new Error(msg);
    }
    console.warn(`⚠ ${msg}`);
  } else {
    console.log(`✓ Asset inexistente tratado corretamente (status=${fakeRes.status}, type=${fakeCt || 'none'})`);
  }
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

  console.log('KÔMA production smoke (somente GET/OPTIONS; nenhuma mutação)');
  console.log(`Frontend: ${frontendUrl}`);
  console.log(`API: ${apiUrl}`);
  if (expectedApiSha) {
    console.log(`Commit esperado no backend: ${expectedApiSha.slice(0, 12)}`);
  }

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
