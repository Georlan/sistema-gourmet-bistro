import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditableTabletFrame } from '../src/landing/product/EditableTabletFrame';
import geometry from '../src/landing/product/tabletFrameGeometry.json';

test('tablet has a real RGBA PNG shell at the native exported resolution', () => {
  const png = readFileSync(new URL('../src/assets/koma-tablet-graphite-shell-v2.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), geometry.crop.width);
  assert.equal(png.readUInt32BE(20), geometry.crop.height);
  assert.equal(png[25], 6, 'PNG colour type must carry real RGBA, not RGB/checkerboard');
});

test('tablet shows separate inert HTML by default and loads the tour shell lazily', () => {
  const html = renderToStaticMarkup(createElement(EditableTabletFrame, { shellSrc: '/tablet.png' }, createElement('p', null, 'Cozinha do Kôma')));
  assert.ok(html.includes('data-screen-mode="content"'));
  assert.match(html, /class="koma-editable-tablet-content" aria-hidden="true" inert=""/);
  assert.ok(html.includes('Cozinha do Kôma'));
  assert.ok(html.includes('loading="lazy"'));
  assert.ok(html.includes('width="1230" height="900"'));
});

test('tablet accepts real screenshots without mounting the demo or stretching them', () => {
  const html = renderToStaticMarkup(createElement(EditableTabletFrame, {
    shellSrc: '/tablet.png', screenshot: { src: '/cozinha-real.webp', alt: 'Cozinha real' },
  }, createElement('p', null, 'Demo anterior')));
  assert.ok(html.includes('src="/cozinha-real.webp"'));
  assert.ok(html.includes('alt="Cozinha real"'));
  assert.ok(html.includes('object-fit:contain;object-position:center'));
  assert.equal(html.includes('Demo anterior'), false);
});

test('hero shell can be prioritized and a screenshot crop is explicitly opt-in', () => {
  const html = renderToStaticMarkup(createElement(EditableTabletFrame, {
    shellSrc: '/tablet.png', priority: true,
    screenshot: { src: '/outra-tela.webp', alt: 'Outra tela', fit: 'cover', position: 'top' },
  }));
  assert.ok(html.includes('loading="eager"'));
  assert.ok(html.includes('fetchPriority="high"'));
  assert.ok(html.includes('object-fit:cover;object-position:top'));
});

test('screen corners stay within the cropped shell and the tour uses the approved tablet', () => {
  for (const [x, y] of geometry.screenCorners) {
    assert.ok(x >= geometry.crop.left && x <= geometry.crop.left + geometry.crop.width);
    assert.ok(y >= geometry.crop.top && y <= geometry.crop.top + geometry.crop.height);
  }
  const tour = readFileSync(new URL('../src/landing/sections/HowItWorks.tsx', import.meta.url), 'utf8');
  assert.ok(tour.includes('<TabletFrame view={screen.view} screenshot={cozinhaScreenshot} />'));
  assert.ok(tour.includes('<EditablePhoneFrame'));
  assert.ok(tour.includes('<LaptopFrame'));
});
