import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const caixa = readFileSync(new URL("../src/components/CaixaPanel.tsx", import.meta.url), "utf8");
const alerts = readFileSync(new URL("../src/components/caixa/realtime/useCashierAlerts.ts", import.meta.url), "utf8");
const refund = readFileSync(new URL("../src/components/caixa/EstornoModal.tsx", import.meta.url), "utf8");

test("novo pedido emite uma única nota e não tenta tocar antes do desbloqueio do navegador", () => {
  const block = alerts.match(/if \(type === 'new_order'\) \{[\s\S]*?\} else if \(type === 'bill_requested'\)/)?.[0] || "";
  assert.match(block, /Um único bipe curto confirma um novo pedido/);
  assert.equal((block.match(/\{ freq:/g) || []).length, 1);
  assert.match(caixa, /useCashierAlerts\(/);
  assert.match(alerts, /audioUnlockedRef\.current/);
  assert.match(alerts, /addEventListener\('pointerdown', unlock/);
  assert.doesNotMatch(alerts, /Bipe duplo suave e moderno de novo pedido/);
});

test("pedido digital pendente executa até 3 ciclos de alerta com cancelamento antecipado e sem banner amarelo invasivo", () => {
  assert.match(alerts, /pendingAlertTimersRef = useRef<Map<string, number\[\]>>/);
  assert.match(alerts, /window\.setTimeout\(\(\) => \{[\s\S]*?\}, 4000\)/);
  assert.match(alerts, /window\.setTimeout\(\(\) => \{[\s\S]*?\}, 8000\)/);
  assert.match(alerts, /window\.clearTimeout\(timerId\)/);
  assert.doesNotMatch(alerts, /window\.setInterval/);
  assert.match(caixa, /orders: pendingAcceptanceOrders/);
  assert.doesNotMatch(caixa, /O alerta sonoro continua até todos serem aceitos ou recusados/);
  assert.doesNotMatch(caixa, /bg-amber-300 px-5 py-3 text-left text-amber-950/);
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
