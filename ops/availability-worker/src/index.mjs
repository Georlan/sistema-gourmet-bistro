const DEFAULT_FRONTEND_URL = 'https://app.komafood.com.br';
const DEFAULT_CENTRAL_URL = 'https://central.komafood.com.br';
const DEFAULT_API_URL = 'https://sistema-gourmet-bistro-production.up.railway.app';

export const DEFAULT_RETEST_DELAY_MS = 15_000;
export const DEFAULT_ALERT_COOLDOWN_MS = 30 * 60_000;
export const DEFAULT_POOL_WAIT_WARN_MS = 1_500;
const KV_STATE_KEY = 'koma:availability:state:v1';

function trimBaseUrl(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

async function checkSingleTarget(url, kind, fetcher) {
  const startedAt = Date.now();
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
    const elapsedMs = Date.now() - startedAt;
    if (!response.ok) {
      return { url, kind, up: false, degraded: false, status: response.status, elapsedMs, reason: `HTTP ${response.status}` };
    }
    if (kind === 'html') {
      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('text/html')) {
        return { url, kind, up: false, degraded: false, status: response.status, elapsedMs, reason: `content-type inesperado (${contentType || 'vazio'})` };
      }
      return { url, kind, up: true, degraded: false, status: response.status, elapsedMs, reason: null };
    }
    if (kind === 'ready') {
      const body = await response.json();
      if (body?.database !== 'healthy') {
        return { url, kind, up: false, degraded: false, status: response.status, elapsedMs, reason: `database=${body?.database || 'unknown'}` };
      }
      const timeouts = Number(body?.db_pool?.wait_timeouts_total ?? 0);
      const waitP95 = Number(body?.db_pool?.wait_ms?.p95 ?? 0);
      const wsConnected = body?.websocket?.transport_connected !== false;
      const degradedReasons = [];
      if (timeouts > 0) degradedReasons.push(`db_pool.wait_timeouts_total=${timeouts}`);
      if (waitP95 >= DEFAULT_POOL_WAIT_WARN_MS) degradedReasons.push(`db_pool.wait_ms.p95=${waitP95}ms`);
      if (!wsConnected) degradedReasons.push('websocket.transport_connected=false');
      return {
        url,
        kind,
        up: true,
        degraded: degradedReasons.length > 0,
        status: response.status,
        elapsedMs,
        reason: degradedReasons.length ? degradedReasons.join(', ') : null,
      };
    }
    return { url, kind, up: true, degraded: false, status: response.status, elapsedMs, reason: null };
  } catch (error) {
    return {
      url,
      kind,
      up: false,
      degraded: false,
      status: null,
      elapsedMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeEndpoints(env = {}, fetcher = fetch) {
  const frontendUrl = trimBaseUrl(env.KOMA_FRONTEND_URL, DEFAULT_FRONTEND_URL);
  const centralUrl = trimBaseUrl(env.KOMA_CENTRAL_URL, DEFAULT_CENTRAL_URL);
  const apiUrl = trimBaseUrl(env.KOMA_API_URL, DEFAULT_API_URL);

  const checks = await Promise.all([
    checkSingleTarget(frontendUrl, 'html', fetcher),
    checkSingleTarget(centralUrl, 'html', fetcher),
    checkSingleTarget(`${apiUrl}/health/live`, 'live', fetcher),
    checkSingleTarget(`${apiUrl}/health/ready`, 'ready', fetcher),
  ]);

  const downChecks = checks.filter(item => !item.up);
  const degradedChecks = checks.filter(item => item.up && item.degraded);
  const status = downChecks.length > 0 ? 'DOWN' : degradedChecks.length > 0 ? 'DEGRADED' : 'UP';

  return { status, checks, downChecks, degradedChecks };
}

export function evaluateTransition({
  previousState = null,
  probeStatus,
  nowMs = Date.now(),
  cooldownMs = DEFAULT_ALERT_COOLDOWN_MS,
}) {
  const prevStatus = previousState?.status || 'UP';
  const lastAlertAtMs = typeof previousState?.lastAlertAtMs === 'number' ? previousState.lastAlertAtMs : null;

  if (probeStatus === 'UP') {
    const recovered = prevStatus === 'DOWN' || prevStatus === 'DEGRADED';
    return {
      transition: recovered ? 'RECOVERED' : 'UP',
      shouldAlert: recovered,
      nextState: {
        status: 'UP',
        consecutiveFailures: 0,
        lastAlertAtMs: recovered ? nowMs : lastAlertAtMs,
        lastAlertStatus: recovered ? 'RECOVERED' : (previousState?.lastAlertStatus || null),
        updatedAt: new Date(nowMs).toISOString(),
      },
    };
  }

  const worsened =
    (prevStatus === 'UP' && (probeStatus === 'DEGRADED' || probeStatus === 'DOWN'))
    || (prevStatus === 'DEGRADED' && probeStatus === 'DOWN');
  const cooldownElapsed = lastAlertAtMs === null || (nowMs - lastAlertAtMs) >= cooldownMs;
  const shouldAlert = worsened || (probeStatus !== prevStatus) || cooldownElapsed;

  return {
    transition: probeStatus,
    shouldAlert,
    nextState: {
      status: probeStatus,
      consecutiveFailures: Number(previousState?.consecutiveFailures || 0) + (probeStatus === 'DOWN' ? 1 : 0),
      lastAlertAtMs: shouldAlert ? nowMs : lastAlertAtMs,
      lastAlertStatus: shouldAlert ? probeStatus : (previousState?.lastAlertStatus || null),
      updatedAt: new Date(nowMs).toISOString(),
    },
  };
}

export function buildTelegramMessage({ transition, probeResult }) {
  const headerMap = {
    DOWN: '[KÔMA ALERTA: DOWN] Indisponibilidade confirmada após reteste de 15s',
    DEGRADED: '[KÔMA AVISO: DEGRADED] Degradação detectada no health/ready',
    RECOVERED: '[KÔMA RECUPERADO: UP] Serviços públicos normalizados',
    UP: '[KÔMA] UP',
  };
  const lines = [headerMap[transition] || `[KÔMA] ${transition}`];
  for (const item of probeResult.downChecks || []) {
    lines.push(`- FALHA ${item.url}: ${item.reason}`);
  }
  for (const item of probeResult.degradedChecks || []) {
    lines.push(`- DEGRADADO ${item.url}: ${item.reason}`);
  }
  lines.push('Diagnóstico: npm run ops:triage -- --json');
  return lines.join('\n');
}

async function sendTelegramAlert(env, text, fetcher) {
  const token = String(env?.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = String(env?.TELEGRAM_CHAT_ID || '').trim();
  if (!token || !chatId) return { sent: false, reason: 'telegram_not_configured' };

  const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
    signal: AbortSignal.timeout(10_000),
  });
  return { sent: response.ok, status: response.status };
}

async function signPayloadHmac(secret, rawBody) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  return Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function notifyInvestigationIngest(env, { transition, probeResult, nowMs }, fetcher) {
  const ingestUrl = String(env?.KOMA_AVAILABILITY_INGEST_URL || '').trim();
  const secret = String(env?.AVAILABILITY_WEBHOOK_SECRET || '').trim();
  if (!ingestUrl || !secret) return { sent: false, reason: 'ingest_not_configured' };

  const payload = {
    source: 'availability_worker',
    transition,
    status: probeResult.status,
    occurred_at: new Date(nowMs).toISOString(),
    down_checks: (probeResult.downChecks || []).map(item => ({
      url: item.url,
      kind: item.kind,
      status: item.status,
      reason: item.reason,
      elapsed_ms: item.elapsedMs,
    })),
    degraded_checks: (probeResult.degradedChecks || []).map(item => ({
      url: item.url,
      kind: item.kind,
      status: item.status,
      reason: item.reason,
      elapsed_ms: item.elapsedMs,
    })),
  };
  const rawBody = JSON.stringify(payload);
  const signature = await signPayloadHmac(secret, rawBody);

  try {
    const response = await fetcher(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Koma-Monitor-Signature': `sha256=${signature}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(5_000),
    });
    return { sent: response.ok, status: response.status };
  } catch (error) {
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

let memoryFallbackState = null;

async function readState(env) {
  if (env?.MONITOR_STATE && typeof env.MONITOR_STATE.get === 'function') {
    try {
      const raw = await env.MONITOR_STATE.get(KV_STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  return memoryFallbackState;
}

async function writeState(env, state) {
  if (env?.MONITOR_STATE && typeof env.MONITOR_STATE.put === 'function') {
    await env.MONITOR_STATE.put(KV_STATE_KEY, JSON.stringify(state));
    return;
  }
  memoryFallbackState = state;
}

export async function runScheduledCheck(
  env = {},
  {
    fetcher = fetch,
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    retestDelayMs = DEFAULT_RETEST_DELAY_MS,
    cooldownMs = Number(env?.ALERT_COOLDOWN_MS || DEFAULT_ALERT_COOLDOWN_MS),
    now = () => Date.now(),
  } = {},
) {
  let probeResult = await probeEndpoints(env, fetcher);
  let retested = false;

  if (probeResult.status === 'DOWN' && retestDelayMs > 0) {
    await sleep(retestDelayMs);
    probeResult = await probeEndpoints(env, fetcher);
    retested = true;
  }

  const nowMs = now();
  const previousState = await readState(env);
  const evaluation = evaluateTransition({
    previousState,
    probeStatus: probeResult.status,
    nowMs,
    cooldownMs,
  });

  let alertResult = { sent: false, reason: 'no_transition' };
  let investigationResult = { sent: false, reason: 'no_transition' };
  if (evaluation.shouldAlert) {
    const message = buildTelegramMessage({ transition: evaluation.transition, probeResult });
    [alertResult, investigationResult] = await Promise.all([
      sendTelegramAlert(env, message, fetcher),
      notifyInvestigationIngest(env, { transition: evaluation.transition, probeResult, nowMs }, fetcher),
    ]);
  }

  await writeState(env, evaluation.nextState);
  return {
    status: probeResult.status,
    transition: evaluation.transition,
    retested,
    shouldAlert: evaluation.shouldAlert,
    alertResult,
    investigationResult,
    state: evaluation.nextState,
    checks: probeResult.checks,
  };
}

export default {
  async scheduled(_controller, env, ctx) {
    const promise = runScheduledCheck(env);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(promise);
    await promise;
  },
  async fetch(_request, env) {
    return new Response(
      JSON.stringify({
        service: 'koma-availability-worker',
        mode: 'read-only-cron',
        kv_bound: Boolean(env?.MONITOR_STATE),
        telegram_configured: Boolean(env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  },
};
