import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createSeoWorker } from '../public/_worker.js';
import { LANDING_SEO, landingStructuredData, serializeStructuredData } from '../src/landing/seo';
import { SUBSCRIPTION_PLANS } from '../src/config/subscriptionPlans';

async function serve(url: string, method = 'GET') {
  const paths: string[] = [];
  const worker = createSeoWorker({ 'Content-Security-Policy': "default-src 'self'", 'X-Frame-Options': 'DENY' });
  const response = await worker.fetch(new Request(url, { method }), { ASSETS: {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      return new Response(path === '/seo-landing' ? 'public marketing' : 'operational shell', { headers: { 'Content-Type': 'text/html' } });
    },
  } });
  return { response, paths };
}

test('only public brand hosts receive prerendered landing, with canonical and security headers', async () => {
  for (const host of ['komafood.com.br', 'www.komafood.com.br']) {
    for (const path of ['/', '/index.html', '/landing', '/landing/?view=landing']) {
      const { response, paths } = await serve(`https://${host}${path}`);
      assert.deepEqual(paths, ['/seo-landing']);
      assert.equal(await response.text(), 'public marketing');
      assert.match(response.headers.get('Link')!, /https:\/\/komafood.com.br\//);
      assert.match(response.headers.get('X-Robots-Tag')!, /^index/);
      assert.equal(response.headers.get('Content-Security-Policy'), "default-src 'self'");
      assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
    }
  }
});

test('app/admin/preview and operational view keep the original shell and noindex', async () => {
  for (const url of ['https://app.komafood.com.br/', 'https://central.komafood.com.br/',
    'https://admin.komafood.com.br/', 'https://superadmin.komafood.com.br/',
    'https://super-admin.komafood.com.br/', 'https://preview.project.pages.dev/',
    'https://komafood.com.br/?view=operacional', 'https://komafood.com.br/?view=caixa']) {
    const { response, paths } = await serve(url);
    assert.deepEqual(paths, ['/']);
    assert.equal(await response.text(), 'operational shell');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
    assert.equal(response.headers.get('Link'), null);
  }
});

test('tenant root and activation/deep links are forwarded without rewriting', async () => {
  for (const url of ['https://pizzaria.komafood.com.br/', 'https://app.komafood.com.br/ativar?resume=1',
    'https://app.komafood.com.br/login', 'https://app.komafood.com.br/cardapio']) {
    const { response, paths } = await serve(url);
    assert.deepEqual(paths, [new URL(url).pathname]);
    assert.equal(await response.text(), 'operational shell');
    assert.equal(response.headers.get('Link'), null);
  }
});

test('both internal asset URLs are blocked while the public root avoids Pages extension redirects', async () => {
  for (const path of ['/seo-landing.html', '/seo-landing']) {
    const { response, paths } = await serve(`https://komafood.com.br${path}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
    assert.deepEqual(paths, []);
  }
  const worker = createSeoWorker();
  const response = await worker.fetch(new Request(LANDING_SEO.url), { ASSETS: {
    fetch: async (request: Request) => new URL(request.url).pathname.endsWith('.html')
      ? new Response(null, { status: 308, headers: { Location: '/seo-landing' } })
      : new Response('public marketing'),
  } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Location'), null);
});

test('worker preserves canonical missing-asset handling and valid asset caching', async () => {
  for (const type of ['text/html; charset=utf-8', 'application/javascript']) {
    const worker = createSeoWorker();
    const response = await worker.fetch(new Request('https://app.komafood.com.br/assets/test.js'), { ASSETS: {
      fetch: async () => new Response(type === 'application/javascript' ? 'export {}' : '<html>SPA</html>', {
        headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' },
      }),
    } });
    if (type.startsWith('text/html')) {
      assert.equal(response.status, 404);
      assert.match(response.headers.get('Cache-Control')!, /no-store/);
      assert.match(response.headers.get('Content-Type')!, /text\/plain/);
    } else {
      assert.equal(response.status, 200);
      assert.match(response.headers.get('Cache-Control')!, /immutable/);
    }
  }
});

test('private hosts never advertise public sitemap; tenant robots do not block public menus', async () => {
  const { response } = await serve('https://app.komafood.com.br/sitemap.xml');
  assert.equal(response.status, 404);
  const robots = await serve('https://pizzaria.komafood.com.br/robots.txt');
  assert.equal(await robots.response.text(), 'User-agent: *\nAllow: /\n');
  assert.equal(robots.response.headers.get('X-Robots-Tag'), null);
  const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]), [LANDING_SEO.url]);
  assert.match(readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8'), /Sitemap: https:\/\/komafood.com.br\/sitemap.xml/);
});

test('HEAD preserves public response headers without a body', async () => {
  const { response, paths } = await serve(LANDING_SEO.url, 'HEAD');
  assert.deepEqual(paths, ['/seo-landing']);
  assert.equal(await response.text(), '');
  assert.match(response.headers.get('X-Robots-Tag')!, /^index/);
});

test('structured data uses canonical prices and safely serializes text', () => {
  const data = landingStructuredData('</script>');
  const app = data['@graph'].find(item => item['@type'] === 'SoftwareApplication')!;
  assert.equal(app.offers!.lowPrice, String(Math.min(...SUBSCRIPTION_PLANS.map(plan => plan.price))));
  assert.equal(app.offers!.highPrice, String(Math.max(...SUBSCRIPTION_PLANS.map(plan => plan.price))));
  const encoded = serializeStructuredData(data);
  assert.ok(!encoded.includes('</script>'));
  assert.deepEqual(JSON.parse(encoded), data);
});

test('old event links redirect to Siará and preserve source/query parameters', async () => {
  const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
  for (const path of ['/cearatech', '/cearatech/', '/cearatech/qr', '/cearatech/qr/']) assert.ok(routes.include.includes(path), `Cloudflare must invoke the worker for ${path}`);
  const worker = createSeoWorker({ 'X-Frame-Options': 'DENY' });
  for (const path of ['/cearatech', '/cearatech/qr', '/cearatech/qr/']) {
    const response = await worker.fetch(new Request(`https://komafood.com.br${path}?source=qr_impresso&x=1`), { ASSETS: { fetch: async () => { throw new Error('Redirect should not fetch assets'); } } });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('Location'), `https://komafood.com.br${path.replace('/cearatech','/siaratech')}?source=qr_impresso&x=1`);
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  }
});
