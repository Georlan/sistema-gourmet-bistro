import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { EditableLaptopFrame } from '../src/landing/product/EditableLaptopFrame';
import geometry from '../src/landing/product/laptopFrameGeometry.json';

test('notebook preserves the approved RGBA shell at native resolution', () => {
  const png = readFileSync(new URL('../src/assets/koma-notebook-graphite-shell-v2.png', import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), geometry.width);
  assert.equal(png.readUInt32BE(20), geometry.height);
  assert.equal(png[25], 6, 'The PNG must contain alpha, not an RGB checkerboard');
});

test('notebook mounts independent inert demo content, not a baked screenshot', () => {
  const html = renderToStaticMarkup(createElement(EditableLaptopFrame, { shellSrc: '/notebook.png' }, createElement('p', null, 'Pedidos do Kôma')));
  assert.ok(html.includes('data-screen-mode="content"'));
  assert.match(html, /class="koma-editable-laptop-content" aria-hidden="true" inert=""/);
  assert.ok(html.includes('Pedidos do Kôma'));
  assert.ok(html.includes('loading="lazy"'));
  assert.ok(html.includes('width="1536" height="1024"'));
});

test('real notebook screenshots replace the demo and preserve their aspect ratio', () => {
  const html = renderToStaticMarkup(createElement(EditableLaptopFrame, {
    shellSrc: '/notebook.png', screenshot: { src: '/pedidos-real.webp', alt: 'Pedidos reais do Kôma' },
  }, createElement('p', null, 'Demo que deve desaparecer')));
  assert.ok(html.includes('data-screen-mode="image"'));
  assert.ok(html.includes('src="/pedidos-real.webp"'));
  assert.ok(html.includes('alt="Pedidos reais do Kôma"'));
  assert.ok(html.includes('object-fit:contain;object-position:center'));
  assert.equal(html.includes('Demo que deve desaparecer'), false);
});

test('cropping a notebook screenshot is explicit and never the default', () => {
  const html = renderToStaticMarkup(createElement(EditableLaptopFrame, {
    shellSrc: '/notebook.png',
    screenshot: { src: '/pedidos.webp', alt: 'Pedidos', fit: 'cover', position: 'top' },
  }));
  assert.ok(html.includes('object-fit:cover;object-position:top'));
});

test('notebook canvas is bounded independently of layout and fits the physical visor', () => {
  const { screen, width, height } = geometry;
  assert.ok(screen.left > 0 && screen.top > 0);
  assert.ok(screen.left + screen.width < width);
  assert.ok(screen.top + screen.height < height);
  const css = readFileSync(new URL('../src/landing/product/editable-laptop.css', import.meta.url), 'utf8');
  assert.match(css, /\.koma-editable-laptop-screen\s*\{[^}]*position: absolute/);
  assert.match(css, /aspect-ratio: 1536 \/ 1024/);
  assert.match(css, /min-width: 0/);
  assert.match(css, /overflow: hidden/);
});

test('Pedidos uses the approved notebook while the other devices remain unchanged', () => {
  const tour = readFileSync(new URL('../src/landing/sections/HowItWorks.tsx', import.meta.url), 'utf8');
  assert.ok(tour.includes('<LaptopFrame view={screen.view} screenshot={pedidosScreenshot} />'));
  assert.ok(tour.includes('<TabletFrame view={screen.view} screenshot={cozinhaScreenshot} />'));
  assert.ok(tour.includes('<EditablePhoneFrame shellSrc={phoneShell} screenshot={cardapioScreenshot}>'));
  assert.equal(tour.includes('<FrontalLaptopFrame'), false);
});
