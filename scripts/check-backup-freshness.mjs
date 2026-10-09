#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const PROJECT_ID = '19ab597e-8aad-458f-bea2-57f793e0a53f';
const ENVIRONMENT_ID = '3399896f-98b3-47c8-aec4-bfa0f3afa755';
const SERVICE_ID = '11fb4931-73f2-45b1-ac43-07be08f40c26';
const MAX_AGE_HOURS = 36;
const MAX_RUN_MINUTES = 30;

const result = spawnSync(process.env.RAILWAY_BIN || 'railway', [
  'logs', '--project', PROJECT_ID, '--environment', ENVIRONMENT_ID,
  '--service', SERVICE_ID, '--since', '48h', '--lines', '300', '--json',
], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });

function fail(message) {
  console.error(`✗ Backup freshness: ${message}`);
  process.exit(1);
}

if (result.error || result.status !== 0) fail('não foi possível consultar os logs Railway');

const entries = result.stdout.split('\n').flatMap(line => {
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
if (!completions.length) fail('nenhuma execução concluída nas últimas 48 horas');
const completed = completions.at(-1);
const ageHours = (Date.now() - completed.timestamp) / 3_600_000;
if (ageHours < 0 || ageHours > MAX_AGE_HOURS) fail(`último backup tem ${ageHours.toFixed(1)} horas`);

const run = entries.filter(entry =>
  entry.timestamp <= completed.timestamp &&
  entry.timestamp >= completed.timestamp - MAX_RUN_MINUTES * 60_000,
);
const has = message => run.some(entry => entry.message === message);
const sizeEntry = run.find(entry => /^Backup filesize: [0-9]+(?:\.[0-9]+)? (?:B|kB|MB|GB)$/.test(entry.message));
const size = sizeEntry && Number(sizeEntry.message.match(/^Backup filesize: ([0-9]+(?:\.[0-9]+)?)/)[1]);

if (!has('Backup archive file is valid')) fail('arquivo sem validação confirmada');
if (!size || size <= 0) fail('tamanho do arquivo ausente ou zero');
if (!has('Backup uploaded to S3...')) fail('upload ao S3 não confirmado');
if (entries.some(entry => entry.timestamp > completed.timestamp && /\b(error|failed|failure)\b/i.test(entry.message))) {
  fail('falha posterior ao último backup concluído');
}

console.log(`✓ Backup do banco KÔMA (Supabase) válido e enviado ao S3 em ${new Date(completed.timestamp).toISOString()}; ${sizeEntry.message}; idade ${ageHours.toFixed(1)}h`);
console.log('Escopo: este serviço não comprova backup do Postgres Railway/Evolution, Redis, arquivos Storage ou configuração do agente.');
console.log('Integridade do arquivo e upload não comprovam restauração; conferir o registro do último ensaio isolado.');
