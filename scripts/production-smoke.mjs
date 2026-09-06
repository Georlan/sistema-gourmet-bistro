#!/usr/bin/env node

const DEFAULT_FRONTEND_URL = 'https://sistema-gourmet-bistro.pages.dev';
const DEFAULT_API_URL = 'https://sistema-gourmet-bistro-production.up.railway.app';
const DEFAULT_CORS_PATH = '/cardapio/pedidos';
const DEFAULT_TIMEOUT_MS = 15_000;

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

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.KOMA_SMOKE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function assertOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
  }
}

async function checkApiReadiness(apiUrl) {
  const url = `${apiUrl}/health/ready`;
  const response = await request(url, { method: 'GET' });
  assertOk(response, 'Backend readiness');
  const body = await response.text();
  console.log(`✓ Backend readiness ${response.status} — ${url}${body ? ` — ${body.slice(0, 180)}` : ''}`);
}

async function checkFrontend(frontendUrl) {
  const response = await request(frontendUrl, { method: 'GET' });
  assertOk(response, 'Frontend');
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) {
    throw new Error(`Frontend: content-type inesperado: ${contentType || '(ausente)'}`);
  }
  console.log(`✓ Frontend ${response.status} — ${frontendUrl}`);
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
  const apiUrl = normalizeBaseUrl(process.env.KOMA_API_URL, DEFAULT_API_URL);
  const corsPath = (process.env.KOMA_CORS_PATH || DEFAULT_CORS_PATH).trim();

  console.log('KÔMA production smoke (somente GET/OPTIONS; nenhuma mutação)');
  console.log(`Frontend: ${frontendUrl}`);
  console.log(`API: ${apiUrl}`);

  await checkApiReadiness(apiUrl);
  await checkFrontend(frontendUrl);
  await checkCheckoutCors(apiUrl, frontendUrl, corsPath);

  console.log('✓ Smoke de produção concluído sem falhas.');
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`✗ Smoke de produção falhou: ${message}`);
  process.exitCode = 1;
});
