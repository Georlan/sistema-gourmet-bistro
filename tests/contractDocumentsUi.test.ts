import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const subscriptionTab = readFileSync('src/components/assinatura/AssinaturaPixTab.tsx', 'utf8');
const contractPanel = readFileSync('src/components/assinatura/ContractDocumentsPanel.tsx', 'utf8');

test('assinatura expõe sub-aba de contrato e documentos', () => {
  assert.match(subscriptionTab, /contrato_documentos/);
  assert.match(subscriptionTab, /Contrato e documentos/);
  assert.match(subscriptionTab, /<ContractDocumentsPanel \/>/);
});

test('segunda via consulta apenas o contrato do tenant autenticado', () => {
  assert.match(contractPanel, /\/api\/contracts\/current/);
  assert.match(contractPanel, /koma_caixa_token/);
  assert.match(contractPanel, /Authorization: `Bearer \$\{token\}`/);
  assert.match(contractPanel, /cache: 'no-store'/);
  assert.match(contractPanel, /response\.status === 404/);
  assert.match(contractPanel, /Nenhum contrato vinculado ainda/);
});

test('segunda via mostra prova, documentos e exportação reproduzível', () => {
  assert.match(contractPanel, /Comprovante de Contratação e Licenciamento Eletrônico/);
  assert.match(contractPanel, /Imprimir \/ salvar PDF/);
  assert.match(contractPanel, /Documentos aceitos/);
  assert.match(contractPanel, /Evidências técnicas do aceite/);
  assert.match(contractPanel, /sourceCommit/);
  assert.match(contractPanel, /sourceBlobSha/);
  assert.match(contractPanel, /requestId/);
  assert.match(contractPanel, /sourceIp/);
  assert.match(contractPanel, /userAgent/);
  assert.match(contractPanel, /document\.hash/);
  assert.match(contractPanel, /window\.open/);
  assert.match(contractPanel, /printWindow\.print\(\)/);
});

test('segunda via não contém identidade real hardcoded do prestador', () => {
  assert.doesNotMatch(contractPanel, /101\.688\.783-30/);
  assert.doesNotMatch(contractPanel, /Georlan Gomes e Silva Júnior/);
  assert.doesNotMatch(contractPanel, /jose hamilton/i);
});
