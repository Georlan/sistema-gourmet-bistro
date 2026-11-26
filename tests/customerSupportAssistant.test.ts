import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('widget de Ajuda integra assistente causal e separação honesta de evidências', () => {
  const widget = source('src/components/app/CustomerSupportWidget.tsx');

  assert.match(widget, /\/api\/support\/assist/);
  assert.match(widget, /Analisar com assistente/);
  assert.match(widget, /Possível bug — sem bloqueio de configuração/);
  assert.match(widget, /Condição encontrada na configuração/);
  assert.match(widget, /Erro técnico detectado/);
  assert.match(widget, /Encaminhar para investigação KÔMA/);
  assert.match(widget, /Observações atuais da loja/);
  assert.match(widget, /unrelated_observations_count/);
  assert.match(widget, /interpreted_domain/);
  assert.match(widget, /suspected_bug/);
  assert.match(widget, /evidence_status/);
  assert.doesNotMatch(widget, /backdrop-blur/);
});
