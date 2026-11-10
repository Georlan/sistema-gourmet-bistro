import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWhatsAppContactUrl } from '../src/config/whatsappUtils';

test('contato do restaurante aceita número nacional, DDI e links oficiais', () => {
  assert.equal(buildWhatsAppContactUrl('(88) 99961-6937'), 'https://wa.me/5588999616937');
  assert.equal(buildWhatsAppContactUrl('(55) 99999-1234'), 'https://wa.me/5555999991234');
  assert.equal(buildWhatsAppContactUrl('+55 88 99961-6937'), 'https://wa.me/5588999616937');
  assert.equal(buildWhatsAppContactUrl('https://wa.me/5588999616937?text=oi'), 'https://wa.me/5588999616937');
  assert.equal(buildWhatsAppContactUrl('https://api.whatsapp.com/send?phone=5588999616937'), 'https://wa.me/5588999616937');
});

test('não oferece um link quebrado para valor vazio ou inválido', () => {
  assert.equal(buildWhatsAppContactUrl(''), '');
  assert.equal(buildWhatsAppContactUrl('123'), '');
  assert.equal(buildWhatsAppContactUrl('https://example.com/5588999616937'), '');
});
