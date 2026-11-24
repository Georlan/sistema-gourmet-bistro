#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { summarizeHttp } from './http-observability.mjs';

const PROJECT = '19ab597e-8aad-458f-bea2-57f793e0a53f';
const ENVIRONMENT = '3399896f-98b3-47c8-aec4-bfa0f3afa755';
const SERVICE = 'adedb907-3bee-4bca-ace7-b41910743fe2';
const FRONTEND = process.env.KOMA_FRONTEND_URL || 'https://app.komafood.com.br';
const API = process.env.KOMA_API_URL || 'https://sistema-gourmet-bistro-production.up.railway.app';
const RAILWAY = process.env.RAILWAY_BIN || 'railway';

export async function diagnose(fetcher = fetch) {
  const lines = [];
  let healthy = true;
  async function get(url, label) {
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lines.push(`${label}: OK (${response.status})`);
      return response;
    } catch (error) {
      lines.push(`${label}: FALHA (${error.message})`);
      healthy = false;
      return null;
    }
  }
  const frontend = await get(FRONTEND, 'Frontend');
  if (frontend && !(frontend.headers.get('content-type') || '').includes('text/html')) {
    lines.push('Frontend: content-type inesperado'); healthy = false;
  }
  const live = await get(`${API}/health/live`, 'Backend live');
  if (live) {
    try { lines.push(`Commit backend: ${(await live.json()).commit || 'indisponível'}`); }
    catch { lines.push('Commit backend: resposta inválida'); healthy = false; }
  }
  const ready = await get(`${API}/health/ready`, 'Backend ready');
  if (ready) {
    try {
      const body = await ready.json();
      lines.push(`DB: ${body.database}; latência ${body.database_latency_ms} ms`);
      if (body.db_pool && typeof body.db_pool === 'object') {
        const pool = body.db_pool;
        const checkedOut = pool.checked_out ?? '?';
        const poolSize = pool.pool_size ?? '?';
        const overflow = pool.overflow ?? 0;
        const waitP95 = pool.wait_ms?.p95 ?? 0;
        const holdP95 = pool.hold_ms?.p95 ?? 0;
        const timeouts = Number(pool.wait_timeouts_total || 0);
        const slowWaits = Number(pool.slow_waits_total || 0);
        const slowHolds = Number(pool.slow_holds_total || 0);
        lines.push(
          `DB pool (${pool.pool_type || 'pool'}): ${checkedOut}/${poolSize} em uso (overflow ${overflow}); ` +
          `wait p95 ${waitP95} ms; hold p95 ${holdP95} ms; timeouts ${timeouts}; slow waits ${slowWaits}; slow holds ${slowHolds}`,
        );
        if (timeouts > 0) {
          lines.push(`ALERTA DB pool: ${timeouts} timeout(s) de espera no pool de conexões.`);
          healthy = false;
        } else if (Number(waitP95) >= 500) {
          lines.push(`AVISO DB pool: wait p95 elevado (${waitP95} ms >= 500 ms).`);
        }
      }
      lines.push(`WebSocket: ${body.websocket?.transport_connected ? 'conectado' : 'desconectado'}; instância ${body.websocket?.instance || 'indisponível'}`);
      if (body.database !== 'healthy' || !body.websocket?.transport_connected) healthy = false;
    } catch { lines.push('Backend ready: resposta inválida'); healthy = false; }
  }
  return { lines, healthy };
}

export function extractBackupSummaryLine(backup) {
  const stdoutLines = String(backup?.stdout || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const stderrLines = String(backup?.stderr || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  if (backup?.status === 0) {
    return stdoutLines.find(line => line.startsWith('✓')) || stdoutLines[0] || 'sem resultado';
  }
  return (
    stderrLines.at(-1)
    || stdoutLines.at(-1)
    || backup?.error?.message
    || 'sem resultado'
  );
}

function railway(args) {
  return spawnSync(RAILWAY, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 30000 });
}

async function main() {
  const result = await diagnose();
  for (const line of result.lines) console.log(line);
  const smoke = spawnSync(process.execPath, ['scripts/production-smoke.mjs'], {
    encoding: 'utf8', timeout: 90000, maxBuffer: 100000,
    env: { ...process.env, KOMA_FRONTEND_URL: FRONTEND, KOMA_API_URL: API },
  });
  console.log(`Production smoke: ${smoke.status === 0 ? 'OK' : 'FALHA'}`);
  if (smoke.status !== 0) result.healthy = false;

  const whoami = railway(['whoami']);
  if (whoami.status === 0) {
    const backup = spawnSync(process.execPath, ['scripts/check-backup-freshness.mjs'], {
      encoding: 'utf8', timeout: 45000, env: { ...process.env, RAILWAY_BIN: RAILWAY },
    });
    const backupLine = extractBackupSummaryLine(backup);
    console.log(`Backup: ${backup.status === 0 ? 'OK' : 'STALE/ERRO'} — ${backupLine}`);
    if (backup.status !== 0) result.healthy = false;
    if (process.argv.includes('--deep')) {
      const services = railway(['service', 'list', '--project', PROJECT, '--environment', ENVIRONMENT, '--json']);
      if (services.status === 0) {
        try {
          const api = JSON.parse(services.stdout).find(item => item.id === SERVICE);
          console.log(`Railway deploy: ${api?.deploymentId || 'indisponível'}; status ${api?.status || 'indisponível'}; réplicas ${api?.replicas?.running ?? '?'} / ${api?.replicas?.configured ?? '?'}; crashes ${api?.replicas?.crashed ?? '?'}`);
          if (api?.status !== 'SUCCESS' || api?.replicas?.running !== api?.replicas?.configured) result.healthy = false;
        } catch {
          console.log('Railway deploy: resposta inválida');
          result.healthy = false;
        }
      } else { console.log('Railway deploy: indisponível'); result.healthy = false; }
      const metrics = railway(['metrics', '--project', PROJECT, '--environment', ENVIRONMENT, '--service', SERVICE, '--since', '1h', '--json']);
      if (metrics.status === 0) {
        try {
          const data = JSON.parse(metrics.stdout);
          console.log(`Railway 1h: CPU ${data.cpu?.current ?? '?'} vCPU; RAM ${data.memory?.current_mb ?? '?'} MB; HTTP ${data.http?.total ?? '?'} requests; 5xx ${data.http?.['5xx'] ?? '?'}`);
        } catch {
          console.log('Railway métricas: resposta inválida');
        }
      } else console.log('Railway métricas: indisponível');
      const http = railway(['logs', '--project', PROJECT, '--environment', ENVIRONMENT, '--service', SERVICE, '--since', '1h', '--lines', '1000', '--json']);
      if (http.status === 0) {
        const entries = http.stdout.split('\n').flatMap(line => {
          try {
            const parsed = JSON.parse(line);
            return [parsed.event ? parsed : JSON.parse(parsed.message)];
          } catch { return []; }
        }).filter(item => item.event === 'http_request');
        const errors = entries.filter(item => item.status_code >= 500);
        console.log(`HTTP amostrado na última hora: ${entries.length} requests; ${errors.length} 5xx`);
        console.log(`HTTP por operação (latência somente de HTTP bem-sucedido): ${JSON.stringify(summarizeHttp(entries))}`);
        console.log(`5xx por rota/instância: ${JSON.stringify(errors.reduce((acc, item) => { const key = `${item.path} @${item.instance}`; acc[key] = (acc[key] || 0) + 1; return acc; }, {}))}`);
      } else console.log('HTTP logs: indisponível');
    }
  } else {
    console.log('Backup/Railway: indisponível (CLI não autenticado).');
  }
  if (!result.healthy) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('ops-doctor.mjs')) main().catch(error => {
  console.error(`ops:doctor falhou: ${error.message}`);
  process.exitCode = 1;
});
