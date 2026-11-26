#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PII_OR_SECRET_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(sk_live|sk_test|pk_live|ghp_|gho_|glpat-|postgres:\/\/|Bearer\s+[A-Za-z0-9._-]{12,})/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/,
];

export function assertNoPiiOrSecrets(entry) {
  const serialized = JSON.stringify(entry);
  for (const pattern of PII_OR_SECRET_PATTERNS) {
    if (pattern.test(serialized)) {
      throw new Error(`Entrada bloqueada por conter possível PII ou segredo (${pattern}).`);
    }
  }
}

export function buildMemoryEntry({
  id,
  title,
  category,
  symptoms = [],
  logPatterns = [],
  causes = [],
  verificationSteps = [],
  remediations = [],
  goId = null,
  preventionRefs = [],
}) {
  if (!/^[a-z0-9-]+$/.test(String(id || ''))) {
    throw new Error('id inválido; use apenas letras minúsculas, números e hífen.');
  }
  if (!title || String(title).trim().length < 6) {
    throw new Error('title precisa ter pelo menos 6 caracteres.');
  }
  if (!category || String(category).trim().length < 3) {
    throw new Error('category inválida.');
  }
  const entry = {
    id: String(id),
    title: String(title).trim(),
    category: String(category).trim(),
    symptom_signatures: symptoms.filter(Boolean),
    log_patterns: logPatterns.filter(Boolean),
    likely_causes: causes.filter(Boolean),
    verification_steps: verificationSteps.filter(Boolean),
    safe_remediation: remediations.filter(Boolean),
    customer_guidance_go_id: goId ? String(goId).trim() : null,
    prevention_refs: preventionRefs.filter(Boolean),
  };

  for (const field of [
    'symptom_signatures',
    'log_patterns',
    'likely_causes',
    'verification_steps',
    'safe_remediation',
    'prevention_refs',
  ]) {
    if (!entry[field].length) {
      throw new Error(`Campo obrigatório vazio em incident-memory: ${field}`);
    }
  }
  assertNoPiiOrSecrets(entry);
  return entry;
}

export function promoteMemoryEntry(
  entry,
  indexPath = resolve(process.cwd(), 'docs/operations/incident-memory/index.json'),
  { dryRun = false } = {},
) {
  const current = JSON.parse(readFileSync(indexPath, 'utf8'));
  const entries = Array.isArray(current.entries) ? [...current.entries] : [];
  if (entries.some(item => item.id === entry.id)) {
    throw new Error(`Entrada já existe em incident-memory: ${entry.id}`);
  }
  entries.push(entry);
  const nextDoc = {
    schema_version: current.schema_version || '1.0',
    updated_at: new Date().toISOString().slice(0, 10),
    entries,
  };
  if (!dryRun) {
    writeFileSync(indexPath, `${JSON.stringify(nextDoc, null, 2)}\n`);
  }
  return { dryRun, totalEntries: entries.length, entry };
}

function parsePromoteArgs(argv = []) {
  const out = { dryRun: false, fromJson: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') out.dryRun = true;
    else if (token === '--from-json' && i + 1 < argv.length) out.fromJson = argv[++i];
  }
  return out;
}

if (process.argv[1]?.endsWith('ops-memory-promote.mjs')) {
  const args = parsePromoteArgs(process.argv.slice(2));
  if (!args.fromJson) {
    console.error('Uso: npm run ops:memory:promote -- --from-json <arquivo.json> [--dry-run]');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), args.fromJson), 'utf8'));
  const entry = buildMemoryEntry(raw);
  const result = promoteMemoryEntry(entry, undefined, { dryRun: args.dryRun });
  console.log(JSON.stringify(result, null, 2));
}
