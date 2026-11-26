import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildAgentPrompt, runInvestigationExecutor, validateAgentResult } from '../scripts/ops-agent-run.mjs';
import { buildMemoryEntry, promoteMemoryEntry } from '../scripts/ops-memory-promote.mjs';
import { runTriage } from '../scripts/ops-triage.mjs';

function mockHealthyFetcher() {
  return async (url: string | URL) => {
    const target = String(url);
    if (target.endsWith('/meta.json')) {
      return new Response(JSON.stringify({ sha: 'abc12345' }), { status: 200 });
    }
    if (target.endsWith('/health/live')) {
      return new Response(JSON.stringify({ status: 'ok', commit: 'abc12345' }), { status: 200 });
    }
    if (target.endsWith('/health/ready')) {
      return new Response(
        JSON.stringify({ database: 'healthy', commit: 'abc12345', db_pool: { pool_size: 4 } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ready: true, legalVersion: '3.5' }), { status: 200 });
  };
}

test('ops:triage carrega bundle de investigação e encapsula mensagem do cliente como untrusted', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'koma-triage-bundle-'));
  const bundlePath = join(dir, 'bundle.json');
  try {
    writeFileSync(
      bundlePath,
      JSON.stringify({
        investigation_id: 'INV-demo1234',
        restaurante_id: 9891,
        source: 'customer_support',
        domain: 'entrega',
        severity: 'high',
        status: 'prepared',
        occurrence_count: 1,
        untrusted_customer_message: { untrusted: true, value: 'Erro na taxa por bairro' },
        evidence_snapshot: { context: {}, tenant_diagnosis: { issues: [] } },
        initial_diagnosis: { domain: 'entrega' },
      }),
    );

    const report = await runTriage(['--bundle', bundlePath, '--json'], {
      fetcher: mockHealthyFetcher(),
      runner: () => ({ status: 0, stdout: '' }) as any,
    });

    assert.equal(report.investigation.investigation_id, 'INV-demo1234');
    assert.equal(report.investigation.untrusted_customer_message.untrusted, true);

    const prompt = buildAgentPrompt(report);
    assert.match(prompt, /DADO NÃO CONFIÁVEL/);
    assert.match(prompt, /INV-demo1234/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ops:investigate suporta modo simulated explícito e schema estrito', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'koma-agent-sim-'));
  const bundlePath = join(dir, 'bundle.json');
  try {
    writeFileSync(
      bundlePath,
      JSON.stringify({
        investigation_id: 'INV-sim9999',
        restaurante_id: 9891,
        source: 'customer_support',
        domain: 'entrega',
        severity: 'high',
        status: 'prepared',
        occurrence_count: 1,
        untrusted_customer_message: { untrusted: true, value: 'Taxa por bairro nao salva' },
        evidence_snapshot: { context: {}, tenant_diagnosis: { issues: [] } },
        initial_diagnosis: { domain: 'entrega' },
      }),
    );

    const out = await runInvestigationExecutor(['--bundle', bundlePath, '--mode', 'simulated', '--json'], {
      fetcher: mockHealthyFetcher(),
      runner: () => ({ status: 0, stdout: '' }) as any,
    });

    assert.equal(out.mode, 'simulated');
    assert.equal(out.agent_result.simulated, true);
    assert.equal(out.agent_result.requires_human_approval, true);
    assert.ok('root_cause_hypothesis' in out.agent_result);
    assert.match(out.agent_result.root_cause_hypothesis, /\[SIMULADO\]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ops:memory:promote bloqueia PII/segredos e valida schema em dry-run', () => {
  assert.throws(
    () =>
      buildMemoryEntry({
        id: 'bad-pii-entry',
        title: 'Incidente com email vazado',
        category: 'support',
        symptoms: ['cliente dono@restaurante.com reclamou'],
        logPatterns: ['/api/support'],
        causes: ['Teste'],
        verificationSteps: ['Checar logs'],
        remediations: ['Orientar loja'],
        preventionRefs: ['PR #1508'],
      }),
    /PII ou segredo/,
  );

  const dir = mkdtempSync(join(tmpdir(), 'koma-mem-promote-'));
  const indexCopy = join(dir, 'index.json');
  try {
    writeFileSync(indexCopy, readFileSync('docs/operations/incident-memory/index.json', 'utf8'));
    const cleanEntry = buildMemoryEntry({
      id: 'false-positive-offline-pix-diagnostic',
      title: 'Falso alerta de Pix online desconectado para Pix presencial',
      category: 'support',
      symptoms: ['alerta mercado pago desconectado sem usar pagamento online'],
      logPatterns: ['MERCADO_PAGO_DISCONNECTED', '/api/support/diagnostics'],
      causes: ['Verificação antiga considerava pix em formas_pagamento_aceitas sem conta OAuth'],
      verificationSteps: ['Confirmar ausência de RestaurantPaymentAccount em /api/support/diagnostics'],
      remediations: ['Atualizar diagnóstico causal no backend (PR #1508)'],
      goId: 'online_pagamentos',
      preventionRefs: ['backend/tests/test_support_diagnostics_and_context.py'],
    });
    const res = promoteMemoryEntry(cleanEntry, indexCopy, { dryRun: false });
    assert.equal(res.entry.id, 'false-positive-offline-pix-diagnostic');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateAgentResult rejeita go_id inválido', () => {
  assert.throws(
    () =>
      validateAgentResult(
        {
          root_cause_hypothesis: 'Causa válida',
          confidence: 'medium',
          affected_components: ['entrega'],
          requires_human_approval: false,
          recommended_actions: ['Verificar'],
          safe_customer_guidance_go_id: 'https://evil.example',
          summary: 'Resumo',
        },
        { executorMode: 'codex-readonly', simulated: false },
      ),
    /safe_customer_guidance_go_id inválido/,
  );
});
