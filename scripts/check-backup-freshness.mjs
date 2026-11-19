#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const PROJECT_ID = '19ab597e-8aad-458f-bea2-57f793e0a53f';
const ENVIRONMENT_ID = '3399896f-98b3-47c8-aec4-bfa0f3afa755';
const SERVICE_ID = '11fb4931-73f2-45b1-ac43-07be08f40c26';
export const MAX_AGE_HOURS = 36;
export const MAX_RUN_MINUTES = 30;
export const LOG_FLUSH_JITTER_MS = 5_000;
export const BACKUP_ISSUE_TITLE = '[KÔMA] Falha no monitor de backup';

export function evaluateBackupLogs(stdout, nowMs = Date.now()) {
  const entries = String(stdout || '').split('\n').flatMap(line => {
    try {
      const value = JSON.parse(line);
      const timestamp = Date.parse(value.timestamp);
      return Number.isFinite(timestamp) && typeof value.message === 'string'
        ? [{ timestamp, message: value.message }]
        : [];
    } catch {
      return [];
    }
  }).sort((a, b) => a.timestamp - b.timestamp);

  const completions = entries.filter(entry => entry.message === 'Database backup complete.');
  if (!completions.length) {
    return { ok: false, reason: 'missing', message: 'nenhuma execução concluída nas últimas 48 horas' };
  }
  const completed = completions.at(-1);
  const ageHours = (nowMs - completed.timestamp) / 3_600_000;
  if (ageHours < 0 || ageHours > MAX_AGE_HOURS) {
    return {
      ok: false,
      reason: 'stale',
      ageHours,
      message: `último backup tem ${ageHours.toFixed(1)} horas`,
    };
  }

  const runFloor = completed.timestamp - MAX_RUN_MINUTES * 60_000;
  const runStartsBefore = entries.filter(
    entry => entry.message === 'Starting Container' && entry.timestamp <= completed.timestamp && entry.timestamp >= runFloor,
  );
  const runStart = runStartsBefore.length ? runStartsBefore.at(-1).timestamp : runFloor;
  const nextContainerStart = entries.find(
    entry => entry.message === 'Starting Container' && entry.timestamp > completed.timestamp,
  );
  const runEnd = Math.min(
    completed.timestamp + LOG_FLUSH_JITTER_MS,
    nextContainerStart ? nextContainerStart.timestamp - 1 : Infinity,
  );

  const run = entries.filter(entry =>
    entry.timestamp >= runStart &&
    entry.timestamp <= runEnd,
  );
  const has = message => run.some(entry => entry.message === message);
  const sizeEntry = run
    .filter(entry => /^Backup filesize: [0-9]+(?:\.[0-9]+)? (?:B|kB|MB|GB)$/.test(entry.message))
    .at(-1);
  const size = sizeEntry && Number(sizeEntry.message.match(/^Backup filesize: ([0-9]+(?:\.[0-9]+)?)/)[1]);

  if (!has('Backup archive file is valid')) {
    return { ok: false, reason: 'invalid_archive', message: 'arquivo sem validação confirmada' };
  }
  if (!size || size <= 0) {
    return { ok: false, reason: 'empty_size', message: 'tamanho do arquivo ausente ou zero' };
  }
  if (!has('Backup uploaded to S3...')) {
    return { ok: false, reason: 'upload_missing', message: 'upload ao S3 não confirmado' };
  }
  if (entries.some(entry => entry.timestamp > completed.timestamp && /\b(error|failed|failure)\b/i.test(entry.message))) {
    return { ok: false, reason: 'post_completion_error', message: 'falha posterior ao último backup concluído' };
  }

  const completedAt = new Date(completed.timestamp).toISOString();
  return {
    ok: true,
    reason: 'ok',
    completedAt,
    sizeLabel: sizeEntry.message,
    ageHours,
    message: `Backup do banco KÔMA (Supabase) válido e enviado ao S3 em ${completedAt}; ${sizeEntry.message}; idade ${ageHours.toFixed(1)}h`,
  };
}

export function checkBackupFreshness({
  railwayBin = process.env.RAILWAY_BIN || 'railway',
  spawn = spawnSync,
  nowMs = Date.now(),
} = {}) {
  const result = spawn(railwayBin, [
    'logs', '--project', PROJECT_ID, '--environment', ENVIRONMENT_ID,
    '--service', SERVICE_ID, '--since', '48h', '--lines', '300', '--json',
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 45_000 });

  if (result.error || result.status !== 0) {
    return {
      ok: false,
      reason: 'access_error',
      message: 'não foi possível consultar os logs Railway',
    };
  }
  return evaluateBackupLogs(result.stdout, nowMs);
}

export async function reconcileBackupIssue({
  result,
  existingIssueNumber = null,
  createIssue,
  updateIssue,
  closeIssue,
  nowIso = new Date().toISOString(),
}) {
  if (!result.ok) {
    const body = [
      `Monitor automático de backup detectou falha (\`${result.reason}\`).`,
      '',
      `Detalhe: ${result.message}`,
      'Escopo: PostgreSQL principal (Supabase) via Railway `Postgres S3 Backup`.',
      `Última verificação: ${nowIso}`,
    ].join('\n');
    if (existingIssueNumber) {
      await updateIssue(existingIssueNumber, body);
      return existingIssueNumber;
    }
    return createIssue(BACKUP_ISSUE_TITLE, body);
  }
  if (existingIssueNumber) {
    await closeIssue(
      existingIssueNumber,
      `Backup regularizado: ${result.message} (${nowIso})`,
    );
  }
  return null;
}

async function notifyGitHubIfConfigured(result) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return;

  const root = `https://api.github.com/repos/${repo}`;
  async function api(path, method = 'GET', body) {
    const response = await fetch(`${root}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub API ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  }

  const issues = await api('/issues?state=open&per_page=100');
  const existing = issues?.find(issue => !issue.pull_request && issue.title === BACKUP_ISSUE_TITLE);
  await reconcileBackupIssue({
    result,
    existingIssueNumber: existing?.number ?? null,
    createIssue: async (title, body) => (await api('/issues', 'POST', { title, body }))?.number,
    updateIssue: async (number, body) => api(`/issues/${number}`, 'PATCH', { body }),
    closeIssue: async (number, body) => {
      await api(`/issues/${number}/comments`, 'POST', { body });
      await api(`/issues/${number}`, 'PATCH', { state: 'closed' });
    },
  });
}

async function main() {
  const result = checkBackupFreshness();
  if (process.argv.includes('--github-issue')) {
    await notifyGitHubIfConfigured(result);
  }
  if (!result.ok) {
    console.error(`✗ Backup freshness: ${result.message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ ${result.message}`);
  console.log('Escopo: este serviço não comprova backup do Postgres Railway/Evolution, Redis, arquivos Storage ou configuração do agente.');
  console.log('Integridade do arquivo e upload não comprovam restauração; conferir o registro do último ensaio isolado.');
}

if (process.argv[1]?.endsWith('check-backup-freshness.mjs')) {
  main().catch(error => {
    console.error(`✗ Backup freshness: ${error.message}`);
    process.exitCode = 1;
  });
}
