import assert from 'node:assert/strict';
import test from 'node:test';

if (!('window' in globalThis)) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { hostname: 'localhost', protocol: 'http:', pathname: '/siaratech' },
      scrollTo() {},
    },
  });
}

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CearaTechLeadPage from '../src/landing/CearaTechLeadPage';
import { aplicarMascaraTelefoneInput } from '../src/utils/phonePresentation';

test('CearaTechLeadPage renders mobile-first lead capture form without requiring login', () => {
  const html = renderToStaticMarkup(createElement(CearaTechLeadPage));
  assert.ok(html.includes('KÔMA'));
  assert.ok(html.includes('Siará Tech Summit'));
  assert.ok(html.includes('Pedidos, cozinha e caixa juntos.'));
  assert.ok(html.includes('Seu Nome *'));
  assert.ok(html.includes('WhatsApp com DDD *'));
  assert.ok(html.includes('Aceito receber contato da equipe KÔMA pelo WhatsApp'));
  assert.ok(html.includes('QUERO CONHECER O KÔMA'));
  assert.ok(html.includes('https://instagram.com/georlanjunior') || html.includes('@georlanjunior'));
});

test('phone formatting mask formats Brazilian mobile phones correctly', () => {
  assert.equal(aplicarMascaraTelefoneInput('85999998888'), '(85) 99999-8888');
  assert.equal(aplicarMascaraTelefoneInput('11912345678'), '(11) 91234-5678');
  assert.equal(aplicarMascaraTelefoneInput('85'), '(85');
  assert.equal(aplicarMascaraTelefoneInput('859'), '(85) 9');
});
