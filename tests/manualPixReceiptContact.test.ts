import assert from 'node:assert/strict';
import test from 'node:test';
import { manualPixReceiptUrl } from '../src/cardapio/manualPixReceiptUrl';

test('comprovante abre conversa voluntária somente para o restaurante do pedido', () => {
  const url = manualPixReceiptUrl({ phone: '(88) 99961-6937', restaurantId: 1, order: { restaurante_id: 1, numero_pedido: 47, pagamento: { confirmacao_manual: true } } });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://wa.me/5588999616937');
  assert.match(parsed.searchParams.get('text') || '', /pedido #47/);
  assert.equal(manualPixReceiptUrl({ phone: '(88) 99961-6937', restaurantId: 2, order: { restaurante_id: 1, numero_pedido: 47, pagamento: { confirmacao_manual: true } } }), '');
  assert.equal(manualPixReceiptUrl({ phone: '', restaurantId: 1, order: { restaurante_id: 1, numero_pedido: 47, pagamento: { confirmacao_manual: true } } }), '');
  assert.equal(manualPixReceiptUrl({ phone: '(88) 99961-6937', restaurantId: 1, order: { restaurante_id: 1, numero_pedido: 47, pagamento: { confirmacao_manual: false } } }), '');
  assert.equal(manualPixReceiptUrl({ phone: '(88) 99961-6937', restaurantId: 1, order: { restaurante_id: 1, numero_pedido: 47, pagamento: { confirmacao_manual: true, status: 'approved' } } }), '');
});
