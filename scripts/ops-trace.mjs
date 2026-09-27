#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const ENVIRONMENTS = {
  production: { project: '19ab597e-8aad-458f-bea2-57f793e0a53f', environment: '3399896f-98b3-47c8-aec4-bfa0f3afa755', service: 'adedb907-3bee-4bca-ace7-b41910743fe2' },
  homologation: { project: '6aca32bc-4b1e-4499-a014-dd14791341bb', environment: 'b8cb3831-25f3-4697-81af-29e35f595b81', service: '615adbd7-17e9-4f5e-b455-0d1e9edb750d' },
};

export function parseTraceLines(lines, id) {
  return lines.flatMap(line => {
    try {
      const railway = JSON.parse(line);
      let entry = railway;
      if (!entry.event && typeof railway.message === 'string') {
        try { entry = JSON.parse(railway.message); } catch { return []; }
      }
      if (!['http_request', 'http_exception'].includes(entry.event)) return [];
      if (entry.request_id !== id && entry.support_code !== id) return [];
      return [{ ...entry, timestamp: entry.timestamp || railway.timestamp }];
    } catch { return []; }
  }).slice(-20);
}

function main() {
  const [id, environmentName = 'production'] = process.argv.slice(2);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    console.error('Uso: npm run ops:trace -- <request-id-ou-support-code> [production|homologation]');
    process.exitCode = 2;
    return;
  }
  const target = ENVIRONMENTS[environmentName];
  if (!target?.environment || !target.service) {
    console.error('Serviço Railway não configurado para este ambiente (KOMA_API_SERVICE_ID / KOMA_HOMOL_API_SERVICE_ID).');
    process.exitCode = 2;
    return;
  }
  const result = spawnSync(process.env.RAILWAY_BIN || 'railway', [
    'logs', '--project', target.project, '--environment', target.environment, '--service', target.service,
    '--since', process.env.KOMA_TRACE_SINCE || '24h', '--lines', '100',
    '--filter', id.length <= 12 ? `@support_code:${id}` : `@request_id:${id}`, '--json',
  ], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 30000 });
  if (result.error || result.status !== 0) {
    console.error('Não foi possível consultar os logs Railway; confira a sessão CLI e os IDs do serviço.');
    process.exitCode = 1;
    return;
  }
  const matches = parseTraceLines(result.stdout.split('\n'), id);
  if (!matches.length) {
    console.log(`Nenhum log estruturado encontrado para ${id} nas últimas ${process.env.KOMA_TRACE_SINCE || '24h'}.`);
    process.exitCode = 1;
    return;
  }
  for (const entry of matches) {
    console.log(JSON.stringify({
      timestamp: entry.timestamp, request_id: entry.request_id, event: entry.event,
      method: entry.method, path: entry.path, status: entry.status_code,
      duration_ms: entry.duration_ms, instance: entry.instance,
      restaurante_id: entry.restaurante_id, exception_type: entry.exception_type,
    }));
  }
}

if (process.argv[1]?.endsWith('ops-trace.mjs')) main();
