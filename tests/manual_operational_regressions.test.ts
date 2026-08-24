import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const caixa = readFileSync(new URL("../src/components/CaixaPanel.tsx", import.meta.url), "utf8");
const refund = readFileSync(new URL("../src/components/caixa/EstornoModal.tsx", import.meta.url), "utf8");

test("novo pedido emite uma única nota e não tenta tocar antes do desbloqueio do navegador", () => {
  const block = caixa.match(/if \(type === 'new_order'\) \{[\s\S]*?\} else if \(type === 'bill_requested'\)/)?.[0] || "";
  assert.match(block, /Um único bipe curto confirma um novo pedido/);
  assert.equal((block.match(/\{ freq:/g) || []).length, 1);
  assert.match(caixa, /audioUnlockedRef\.current/);
  assert.doesNotMatch(caixa, /Bipe duplo suave e moderno de novo pedido/);
});

test("banner de pedidos explica a próxima ação em vez de usar atenção genérica", () => {
  assert.match(caixa, /label: 'pagamentos para confirmar'/);
  assert.match(caixa, /label: 'pedidos para aceitar'/);
  assert.match(caixa, /label: 'prontos para concluir'/);
  assert.match(caixa, /label: 'pedidos há \+15 min'/);
  assert.doesNotMatch(caixa, /label: 'exigem atenção'/);
});

test("troca de pagamento na devolução atualiza formulário de forma atômica", () => {
  assert.match(refund, /const selectPayment = \(payment: RefundablePayment \| null\) =>/);
  assert.match(refund, /onClick=\{\(\) => selectPayment\(payment\)\}/);
  assert.doesNotMatch(refund, /\}, \[selectedId\]\);/);
  assert.match(refund, /Parte \${index \+ 1}/);
});
