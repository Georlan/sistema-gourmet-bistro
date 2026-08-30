import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditablePhoneFrame } from '../src/landing/product/EditablePhoneFrame';

test('phone keeps content independent from the rendered shell and inert', () => {
  const html = renderToStaticMarkup(createElement(EditablePhoneFrame, { shellSrc: '/shell.png' }, createElement('p', null, 'Interface do Kôma')));
  assert.ok(html.includes('data-screen-mode="content"'));
  assert.ok(html.includes('Interface do Kôma'));
  assert.match(html, /class="koma-editable-phone-content" aria-hidden="true" inert=""/);
  assert.match(html, /<image href="\/shell.png"/);
  assert.ok(html.includes('<mask'));
});

test('real screenshot replaces demo and preserves the whole image by default', () => {
  const html = renderToStaticMarkup(createElement(EditablePhoneFrame, {
    shellSrc: '/shell.png', screenshot: { src: '/cardapio-real.webp', alt: 'Cardápio real do Kôma' },
  }, createElement('p', null, 'Conteúdo anterior')));
  assert.ok(html.includes('data-screen-mode="image"'));
  assert.ok(html.includes('src="/cardapio-real.webp"'));
  assert.ok(html.includes('alt="Cardápio real do Kôma"'));
  assert.ok(html.includes('object-fit:contain;object-position:center'));
  assert.equal(html.includes('Conteúdo anterior'), false);
});

test('an intentional image crop and position can be configured without changing shell', () => {
  const html = renderToStaticMarkup(createElement(EditablePhoneFrame, {
    shellSrc: '/shell.png', screenshot: { src: '/outra-tela.webp', alt: 'Outra tela', fit: 'cover', position: 'top' },
  }));
  assert.ok(html.includes('object-fit:cover;object-position:top'));
  assert.match(html, /<image href="\/shell.png"/);
});

test('two phone instances use independent masks', () => {
  const html = renderToStaticMarkup(createElement('div', null,
    createElement(EditablePhoneFrame, { shellSrc: '/shell.png' }),
    createElement(EditablePhoneFrame, { shellSrc: '/shell.png' }),
  ));
  const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map(match => match[1]);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, 2);
  for (const id of ids) assert.ok(html.includes(`mask="url(#${id})"`));
});
