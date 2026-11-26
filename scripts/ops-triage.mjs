#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTraceLines } from './ops-trace.mjs';

export const TRIAGE_SCHEMA_VERSION = '1.0';

const DEFAULT_TARGETS = {
  production: {
    frontendUrl: process.env.KOMA_FRONTEND_URL || 'https://app.komafood.com.br',
    apiUrl: process.env.KOMA_API_URL || 'https://sistema-gourmet-bistro-production.up.railway.app',
    railway: {
      project: '19ab597e-8aad-458f-bea2-57f793e0a53f',
      environment: '3399896f-98b3-47c8-aec4-bfa0f3afa755',
      service: 'adedb907-3bee-4bca-ace7-b41910743fe2',
    },
  },
  homologation: {
    frontendUrl: process.env.KOMA_HOMOL_FRONTEND_URL || 'https://app.komafood.com.br',
    apiUrl: process.env.KOMA_HOMOL_API_URL || 'https://sistema-gourmet-bistro-production.up.railway.app',
    railway: {
      project: '6aca32bc-4b1e-4499-a014-dd14791341bb',
      environment: 'b8cb3831-25f3-4697-81af-29e35f595b81',
      service: '615adbd7-17e9-4f5e-b455-0d1e9edb750d',
    },
  },
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function wrapUntrusted(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object' && 'untrusted' in value && 'value' in value) {
    return { untrusted: true, value: String(value.value) };
  }
  return { untrusted: true, value: String(value) };
}

export function parseArgs(argv = []) {
  const result = {
    supportCode: null,
    tenantId: null,
    investigationId: null,
    domain: null,
    bundlePath: null,
    environment: 'production',
    symptom: '',
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') {
      result.json = true;
    } else if (token === '--support-code' && i + 1 < argv.length) {
      result.supportCode = String(argv[++i]).trim();
    } else if (token.startsWith('--support-code=')) {
      result.supportCode = token.slice('--support-code='.length).trim();
    } else if (token === '--tenant' && i + 1 < argv.length) {
      result.tenantId = String(argv[++i]).trim();
    } else if (token.startsWith('--tenant=')) {
      result.tenantId = token.slice('--tenant='.length).trim();
    } else if (token === '--investigation' && i + 1 < argv.length) {
      result.investigationId = String(argv[++i]).trim();
    } else if (token.startsWith('--investigation=')) {
      result.investigationId = token.slice('--investigation='.length).trim();
    } else if (token === '--domain' && i + 1 < argv.length) {
      result.domain = String(argv[++i]).trim().toLowerCase();
    } else if (token.startsWith('--domain=')) {
      result.domain = token.slice('--domain='.length).trim().toLowerCase();
    } else if (token === '--bundle' && i + 1 < argv.length) {
      result.bundlePath = String(argv[++i]).trim();
    } else if (token.startsWith('--bundle=')) {
      result.bundlePath = token.slice('--bundle='.length).trim();
    } else if (token === '--env' && i + 1 < argv.length) {
      result.environment = String(argv[++i]).trim().toLowerCase() || 'production';
    } else if (token.startsWith('--env=')) {
      result.environment = token.slice('--env='.length).trim().toLowerCase() || 'production';
    } else if (token === '--symptom' && i + 1 < argv.length) {
      result.symptom = String(argv[++i]).trim();
    } else if (token.startsWith('--symptom=')) {
      result.symptom = token.slice('--symptom='.length).trim();
    }
  }

  if (result.supportCode && !/^[A-Za-z0-9_-]{8,64}$/.test(result.supportCode)) {
    throw new Error('Código de suporte inválido (--support-code). Use 8 a 64 caracteres alfanuméricos/_/-.');
  }
  if (result.tenantId && !/^[1-9][0-9]*$/.test(result.tenantId)) {
    throw new Error('ID de tenant inválido (--tenant). Informe inteiro positivo.');
  }
  if (result.investigationId && !/^INV-[A-Za-z0-9_-]{4,36}$/.test(result.investigationId)) {
    throw new Error('ID de investigação inválido (--investigation). Use o formato INV-<id>.');
  }
  if (result.domain && !/^[a-z0-9_-]{2,48}$/.test(result.domain)) {
    throw new Error('Domínio inválido (--domain).');
  }
  if (!['production', 'homologation'].includes(result.environment)) {
    throw new Error('Ambiente inválido (--env). Use production ou homologation.');
  }
  return result;
}

export function loadIncidentMemory(indexPath = resolve(process.cwd(), 'docs/operations/incident-memory/index.json')) {
  const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
  return Array.isArray(parsed?.entries) ? parsed.entries : [];
}

export function matchIncidentMemory(entries, { symptom = '', traceEntries = [], liveHealth = null } = {}) {
  const signalTexts = [];
  if (symptom) signalTexts.push(symptom);
  for (const item of traceEntries) {
    signalTexts.push(
      item.path || '',
      item.exception_type || '',
      item.status_code ? `HTTP ${item.status_code}` : '',
      item.event || '',
    );
  }
  if (liveHealth) {
    if (liveHealth.dbPool?.waitTimeoutsTotal > 0) signalTexts.push('wait_timeouts_total QueuePool');
    if (liveHealth.dbPool?.slowWaitsTotal > 0) signalTexts.push('slow_waits_total');
    if (liveHealth.websocket?.connected === false) signalTexts.push('websocket transport_connected false');
    if (liveHealth.shaDrift === true) signalTexts.push('/meta.json /health/ready commit frontend diferente');
    if (liveHealth.databaseHealthy === false) signalTexts.push('/health/ready unhealthy');
  }

  const haystack = normalizeText(signalTexts.filter(Boolean).join(' '));
  if (!haystack) return [];

  const haystackTokens = new Set(haystack.split(/[^a-z0-9_./-]+/).filter(token => token.length >= 3));
  const matches = [];

  for (const entry of entries) {
    const matchedSignals = [];
    let score = 0;

    for (const signature of entry.symptom_signatures || []) {
      const normalizedSig = normalizeText(signature);
      if (!normalizedSig) continue;
      if (haystack.includes(normalizedSig)) {
        score += 4;
        matchedSignals.push(signature);
        continue;
      }
      const sigTokens = normalizedSig.split(/[^a-z0-9_./-]+/).filter(token => token.length >= 4);
      const overlap = sigTokens.filter(token => haystackTokens.has(token));
      if (overlap.length >= 2) {
        score += 2;
        matchedSignals.push(signature);
      } else if (overlap.length === 1 && sigTokens.length === 1) {
        score += 1;
        matchedSignals.push(signature);
      }
    }

    for (const pattern of entry.log_patterns || []) {
      const normalizedPat = normalizeText(pattern);
      if (normalizedPat && haystack.includes(normalizedPat)) {
        score += 3;
        matchedSignals.push(pattern);
      }
    }

    if (score > 0) {
      matches.push({
        id: entry.id,
        title: entry.title,
        category: entry.category,
        score,
        matched_signals: matchedSignals.slice(0, 5),
        customer_guidance_go_id: entry.customer_guidance_go_id ?? null,
        verification_steps: entry.verification_steps || [],
        safe_remediation: entry.safe_remediation || [],
        prevention_refs: entry.prevention_refs || [],
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 3);
}

async function fetchJsonSafely(fetcher, url) {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(10000) });
    const status = res.status;
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok, status, body, error: null };
  } catch (error) {
    return { ok: false, status: null, body: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function queryRailwayTrace(args, target, runner) {
  if (!args.supportCode) {
    return { queried: false, status: 'skipped', reason: 'Nenhum --support-code informado.', entries: [] };
  }
  const bin = process.env.RAILWAY_BIN || 'railway';
  const filterArg = args.supportCode.length <= 12
    ? `@support_code:${args.supportCode}`
    : `@request_id:${args.supportCode}`;
  const res = runner(bin, [
    'logs',
    '--project', target.railway.project,
    '--environment', target.railway.environment,
    '--service', target.railway.service,
    '--since', process.env.KOMA_TRACE_SINCE || '24h',
    '--lines', '100',
    '--filter', filterArg,
    '--json',
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });

  if (res.error || res.status !== 0) {
    return {
      queried: true,
      status: 'unavailable',
      reason: 'Railway CLI indisponível ou não autenticado neste ambiente.',
      entries: [],
    };
  }
  const parsed = parseTraceLines(String(res.stdout || '').split('\n'), args.supportCode);
  return {
    queried: true,
    status: parsed.length ? 'matched' : 'empty',
    reason: parsed.length ? null : 'Nenhum evento estruturado encontrado na janela.',
    entries: parsed,
  };
}

export function buildTriageReport({
  args,
  frontendUrl,
  metaProbe,
  liveProbe,
  readyProbe,
  contractsProbe,
  traceResult,
  incidentEntries,
  investigationResult = { queried: false, status: 'skipped', reason: 'Nenhum --investigation informado.', bundle: null },
}) {
  const frontendSha = metaProbe?.body?.commit || metaProbe?.body?.sha || metaProbe?.body?.buildSha || null;
  const backendSha = liveProbe?.body?.commit || readyProbe?.body?.commit || null;
  const shaDrift = Boolean(frontendSha && backendSha && String(frontendSha) !== String(backendSha));
  const pool = readyProbe?.body?.db_pool || null;
  const dbPoolSummary = pool && typeof pool === 'object'
    ? {
        poolType: String(pool.pool_type || 'unknown'),
        poolSize: Number(pool.pool_size ?? 0),
        checkedOut: Number(pool.checked_out ?? 0),
        overflow: Number(pool.overflow ?? 0),
        waitTimeoutsTotal: Number(pool.wait_timeouts_total ?? 0),
        slowWaitsTotal: Number(pool.slow_waits_total ?? 0),
        slowHoldsTotal: Number(pool.slow_holds_total ?? 0),
        waitMsP95: Number(pool.wait_ms?.p95 ?? 0),
        holdMsP95: Number(pool.hold_ms?.p95 ?? 0),
      }
    : null;
  const websocketSummary = readyProbe?.body?.websocket
    ? {
        connected: Boolean(readyProbe.body.websocket.transport_connected),
        activeConnections: Number(readyProbe.body.websocket.active_connections ?? 0),
        instance: wrapUntrusted(readyProbe.body.websocket.instance),
      }
    : null;

  const databaseHealthy = Boolean(readyProbe?.ok && readyProbe?.body?.database === 'healthy');
  const liveHealthSignals = {
    databaseHealthy,
    shaDrift,
    dbPool: dbPoolSummary,
    websocket: websocketSummary,
  };

  const bundle = investigationResult?.bundle || null;
  const bundleUntrustedText = bundle?.untrusted_customer_message?.value || '';
  const combinedSymptom = [
    args.symptom || '',
    args.domain || '',
    bundle?.domain || '',
    bundleUntrustedText,
  ].filter(Boolean).join(' ');

  const matched = matchIncidentMemory(incidentEntries, {
    symptom: combinedSymptom,
    traceEntries: traceResult.entries,
    liveHealth: liveHealthSignals,
  });

  const formattedTraceEntries = traceResult.entries.map(entry => ({
    timestamp: wrapUntrusted(entry.timestamp),
    event: wrapUntrusted(entry.event),
    method: wrapUntrusted(entry.method),
    path: wrapUntrusted(entry.path),
    status_code: Number(entry.status_code ?? 0) || null,
    duration_ms: typeof entry.duration_ms === 'number' ? entry.duration_ms : null,
    restaurante_id: entry.restaurante_id ?? null,
    request_id: wrapUntrusted(entry.request_id),
    support_code: wrapUntrusted(entry.support_code),
    exception_type: wrapUntrusted(entry.exception_type),
    instance: wrapUntrusted(entry.instance),
  }));

  const incidentMatches = matched.map(match => ({
    ...match,
    customer_guidance_url: match.customer_guidance_go_id
      ? `${frontendUrl.replace(/\/$/, '')}/?go=${match.customer_guidance_go_id}`
      : null,
  }));

  const recommendedNextSteps = [
    'Confirmar isolamento por tenant sem mutar dados de produção (ID 6 protegido contra escrita sintética).',
  ];
  for (const match of incidentMatches) {
    if (match.customer_guidance_url) {
      recommendedNextSteps.push(`Orientação direta ao cliente: ${match.customer_guidance_url} (${match.title})`);
    } else if (match.verification_steps?.[0]) {
      recommendedNextSteps.push(`${match.title}: ${match.verification_steps[0]}`);
    }
  }
  if (args.supportCode && traceResult.status === 'unavailable') {
    recommendedNextSteps.push('Autenticar Railway CLI (`railway login`) para correlacionar logs estruturados do support_code.');
  }
  if (args.investigationId && !bundle) {
    recommendedNextSteps.push('Definir KOMA_SUPERADMIN_TOKEN ou --bundle <arquivo.json> para carregar o pacote completo da investigação.');
  }

  return {
    schema_version: TRIAGE_SCHEMA_VERSION,
    read_only: true,
    timestamp: new Date().toISOString(),
    environment: args.environment,
    query: {
      support_code: wrapUntrusted(args.supportCode),
      tenant_id: args.tenantId ? Number(args.tenantId) : (bundle?.restaurante_id ?? null),
      investigation_id: wrapUntrusted(args.investigationId || bundle?.investigation_id || null),
      domain: wrapUntrusted(args.domain || bundle?.domain || null),
      symptom: wrapUntrusted(args.symptom || null),
    },
    investigation: bundle
      ? {
          queried: investigationResult.queried,
          status: investigationResult.status,
          investigation_id: bundle.investigation_id,
          restaurante_id: bundle.restaurante_id ?? null,
          source: bundle.source,
          domain: bundle.domain,
          severity: bundle.severity,
          investigation_status: bundle.status,
          occurrence_count: bundle.occurrence_count,
          untrusted_customer_message: wrapUntrusted(bundleUntrustedText || null),
          evidence_snapshot: bundle.evidence_snapshot || {},
          initial_diagnosis: bundle.initial_diagnosis || {},
          agent_result: bundle.agent_result || null,
        }
      : {
          queried: investigationResult.queried,
          status: investigationResult.status,
          reason: investigationResult.reason,
        },
    live_health: {
      frontend_meta: {
        ok: Boolean(metaProbe?.ok),
        status: metaProbe?.status ?? null,
        commit: wrapUntrusted(frontendSha),
        error: wrapUntrusted(metaProbe?.error),
      },
      backend_live: {
        ok: Boolean(liveProbe?.ok),
        status: liveProbe?.status ?? null,
        commit: wrapUntrusted(backendSha),
        error: wrapUntrusted(liveProbe?.error),
      },
      backend_ready: {
        ok: Boolean(readyProbe?.ok),
        status: readyProbe?.status ?? null,
        database: wrapUntrusted(readyProbe?.body?.database ?? null),
        database_latency_ms: readyProbe?.body?.database_latency_ms ?? null,
        db_pool: dbPoolSummary,
        websocket: websocketSummary,
        error: wrapUntrusted(readyProbe?.error),
      },
      contracts_readiness: {
        ok: Boolean(contractsProbe?.ok),
        status: contractsProbe?.status ?? null,
        ready: typeof contractsProbe?.body?.ready === 'boolean' ? contractsProbe.body.ready : null,
        legal_version: wrapUntrusted(contractsProbe?.body?.legalVersion ?? contractsProbe?.body?.legal_version ?? null),
        error: wrapUntrusted(contractsProbe?.error),
      },
      sha_drift: shaDrift,
    },
    trace: {
      queried: traceResult.queried,
      status: traceResult.status,
      reason: traceResult.reason,
      entries: formattedTraceEntries,
    },
    incident_matches: incidentMatches,
    recommended_next_steps: recommendedNextSteps,
  };
}

async function fetchInvestigationBundle(args, target, fetcher) {
  if (args.bundlePath) {
    const parsed = JSON.parse(readFileSync(resolve(process.cwd(), args.bundlePath), 'utf8'));
    return { queried: true, status: 'loaded_from_bundle', reason: null, bundle: parsed };
  }
  if (!args.investigationId) {
    return { queried: false, status: 'skipped', reason: 'Nenhum --investigation informado.', bundle: null };
  }
  const token = String(process.env.KOMA_SUPERADMIN_TOKEN || '').trim();
  if (!token) {
    return {
      queried: false,
      status: 'token_unavailable',
      reason: 'KOMA_SUPERADMIN_TOKEN não definido neste ambiente.',
      bundle: null,
    };
  }
  try {
    const url = `${target.apiUrl.replace(/\/$/, '')}/api/super-admin/support/investigations/${encodeURIComponent(args.investigationId)}`;
    const res = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return { queried: true, status: 'error', reason: `HTTP ${res.status}`, bundle: null };
    }
    const body = await res.json();
    return { queried: true, status: 'loaded', reason: null, bundle: body };
  } catch (error) {
    return {
      queried: true,
      status: 'error',
      reason: error instanceof Error ? error.message : String(error),
      bundle: null,
    };
  }
}

export async function runTriage(
  argv = process.argv.slice(2),
  {
    fetcher = fetch,
    runner = spawnSync,
    incidentEntries = null,
  } = {},
) {
  const args = parseArgs(argv);
  const target = DEFAULT_TARGETS[args.environment];
  const entries = incidentEntries ?? loadIncidentMemory();

  const [metaProbe, liveProbe, readyProbe, contractsProbe, investigationResult] = await Promise.all([
    fetchJsonSafely(fetcher, `${target.frontendUrl}/meta.json`),
    fetchJsonSafely(fetcher, `${target.apiUrl}/health/live`),
    fetchJsonSafely(fetcher, `${target.apiUrl}/health/ready`),
    fetchJsonSafely(fetcher, `${target.apiUrl}/api/contracts/readiness`),
    fetchInvestigationBundle(args, target, fetcher),
  ]);

  const effectiveSupportCode = args.supportCode
    || investigationResult?.bundle?.evidence_snapshot?.context?.last_support_code
    || null;
  const traceResult = queryRailwayTrace({ ...args, supportCode: effectiveSupportCode }, target, runner);

  return buildTriageReport({
    args,
    frontendUrl: target.frontendUrl,
    metaProbe,
    liveProbe,
    readyProbe,
    contractsProbe,
    traceResult,
    incidentEntries: entries,
    investigationResult,
  });
}

function formatTextReport(report) {
  const lines = [
    `KÔMA ops:triage [${report.environment}] — read-only (${report.timestamp})`,
    `Frontend meta: ${report.live_health.frontend_meta.ok ? 'OK' : 'FALHA'} (commit ${report.live_health.frontend_meta.commit?.value || 'indisponível'})`,
    `Backend live/ready: ${report.live_health.backend_live.ok ? 'OK' : 'FALHA'} / ${report.live_health.backend_ready.ok ? 'OK' : 'FALHA'} (DB ${report.live_health.backend_ready.database?.value || '?'}, commit ${report.live_health.backend_live.commit?.value || '?'})`,
    `Contratos readiness: ${report.live_health.contracts_readiness.ok ? 'OK' : 'FALHA'}`,
    `Trace: ${report.trace.status} (${report.trace.entries.length} eventos)`,
  ];
  if (report.live_health.backend_ready.db_pool) {
    const p = report.live_health.backend_ready.db_pool;
    lines.push(`DB pool: ${p.checkedOut}/${p.poolSize} em uso; wait p95 ${p.waitMsP95} ms; timeouts ${p.waitTimeoutsTotal}`);
  }
  if (report.incident_matches.length) {
    lines.push('Incidentes compatíveis:');
    for (const m of report.incident_matches) {
      lines.push(`- [${m.id}] ${m.title} (score ${m.score})${m.customer_guidance_url ? ` -> ${m.customer_guidance_url}` : ''}`);
    }
  } else {
    lines.push('Incidentes compatíveis: nenhum padrão correspondente encontrado.');
  }
  return lines.join('\n');
}

async function main() {
  const report = await runTriage(process.argv.slice(2));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatTextReport(report));
  }
}

if (process.argv[1]?.endsWith('ops-triage.mjs')) {
  main().catch(error => {
    console.error(`ops:triage erro: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
