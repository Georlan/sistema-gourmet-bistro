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

test('homepage SEO matches real search intent without promising unavailable capabilities', () => {
  assert.match(LANDING_SEO.title, /KÔMA.*Sistema para restaurantes.*PDV.*cardápio digital/i);
  assert.match(LANDING_SEO.description, /gestão para restaurantes.*PDV, mesas, comandas, caixa.*cardápio digital/i);
  assert.match(LANDING_SEO.description, /Recursos avançados disponíveis conforme o plano/);
  assert.doesNotMatch(LANDING_SEO.title + LANDING_SEO.description, /ERP completo|fiscal completo|24 horas/i);
});

test('structured data uses canonical prices and safely serializes text', () => {
  const data = landingStructuredData('</script>');
  const app = data['@graph'].find(item => item['@type'] === 'SoftwareApplication')!;
  assert.equal(app.offers!.lowPrice, String(Math.min(...SUBSCRIPTION_PLANS.map(plan => plan.price))));
  assert.equal(app.offers!.highPrice, String(Math.max(...SUBSCRIPTION_PLANS.map(plan => plan.price))));
  assert.match(serializeStructuredData(data), /instagram\\.com\\/komafoodbr/);
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

test('unsubscribe aliases invoke the worker and suppress referrers without changing the SPA', async () => {
  const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
  for (const path of ['/w/a', '/whatsapp/avisos']) {
    assert.ok(routes.include.includes(path));
    const { response, paths } = await serve(`https://app.komafood.com.br${path}`);
    assert.deepEqual(paths, [path]);
    assert.equal(await response.text(), 'operational shell');
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(response.headers.get('Cache-Control')!, /no-store/);
    assert.match(response.headers.get('X-Robots-Tag')!, /^noindex/);
  }
});


test('WhatsApp and social crawlers receive the matching restaurant title and logo in server HTML', async () => {
  const configCalls: string[] = [];
  const worker = createSeoWorker({}, 'https://api.example.test', async (url: string, init: RequestInit) => {
    configCalls.push(url);
    assert.equal(init.cache, 'no-store');
    return Response.json({
      id: 66,
      slug: 'je-lanches',
      nome: 'Jé & Lanches <Centro>',
      logo_url: 'https://iiowhekvahxiepwcdidm.supabase.co/storage/v1/object/public/cardapio-assets/66/logo/brand.webp',
    });
  });
  const assetPaths: string[] = [];
  const assets = { fetch: async (request: Request) => {
    assetPaths.push(new URL(request.url).pathname);
    return new Response('<html><head><title>Kôma</title></head><body><div id="root"></div></body></html>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': '84', ETag: '"static"' },
    });
  } };
  for (const crawler of ['WhatsApp/2.24', 'facebookexternalhit/1.1', 'TelegramBot', 'Twitterbot']) {
    const response = await worker.fetch(new Request('https://app.komafood.com.br/c/je-lanches?utm_source=share', {
      headers: { 'User-Agent': crawler },
    }), { ASSETS: assets });
    const html = await response.text();
    assert.match(html, /<title>Jé &amp; Lanches &lt;Centro&gt; \| Cardápio<\/title>/);
    assert.match(html, /property="og:title" content="Jé &amp; Lanches &lt;Centro&gt; \| Cardápio"/);
    assert.match(html, /property="og:image" content="https:\/\/iiowhekvahxiepwcdidm.supabase.co\/storage\/v1\/object\/public\/cardapio-assets\/66\/logo\/brand.webp"/);
    assert.match(html, /property="og:url" content="https:\/\/app.komafood.com.br\/c\/je-lanches"/);
    assert.match(html, /name="twitter:image"/);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex');
    assert.match(response.headers.get('Cache-Control')!, /no-store/);
    assert.equal(response.headers.get('Content-Length'), null);
    assert.equal(response.headers.get('ETag'), null);
  }
  assert.deepEqual(assetPaths, Array(4).fill('/c/je-lanches'));
  assert.deepEqual(configCalls, Array(4).fill('https://api.example.test/api/cardapio-digital/config?slug=je-lanches'));
});

test('menu preview never leaks another tenant and falls back safely when logo is missing or unsafe', async () => {
  const shell = '<html><head><title>Kôma</title></head><body>app</body></html>';
  const assets = { fetch: async () => new Response(shell, { headers: { 'Content-Type': 'text/html' } }) };
  for (const logo of [null, 'javascript:alert(1)', 'http://localhost/internal.png']) {
    const worker = createSeoWorker({}, 'https://api.example.test', async () => Response.json({
      id: 22, slug: 'loja-b', nome: 'Loja B', logo_url: logo,
    }));
    const res = await worker.fetch(new Request('https://app.komafood.com.br/c/loja-b', {
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
    }), { ASSETS: assets });
    assert.match(await res.text(), /property="og:image" content="https:\/\/app.komafood.com.br\/logo-koma.png"/);
  }

  for (const payload of [{ id: 22, slug: 'loja-b', nome: 'Loja B', logo_url: 'https://example.test/b.webp' }, null]) {
    const worker = createSeoWorker({}, 'https://api.example.test', async () => Response.json(payload));
    const res = await worker.fetch(new Request('https://app.komafood.com.br/c/loja-a', {
      headers: { 'User-Agent': 'WhatsApp' },
    }), { ASSETS: assets });
    assert.equal(await res.text(), shell, 'unmatched or missing tenant must not produce another restaurant preview');
  }
});

test('regular menu visits and HEAD never call the metadata API or modify the SPA response', async () => {
  let requests = 0;
  const worker = createSeoWorker({}, 'https://api.example.test', async () => {
    requests++;
    throw Error('Unexpected metadata request');
  });
  const assets = { fetch: async () => new Response('<html><head><title>Kôma</title></head><body>app</body></html>', {
    headers: { 'Content-Type': 'text/html' },
  }) };
  for (const request of [
    new Request('https://app.komafood.com.br/c/je-lanches'),
    new Request('https://app.komafood.com.br/c/je-lanches', { method: 'HEAD', headers: { 'User-Agent': 'WhatsApp' } }),
    new Request('https://preview.pages.dev/c/je-lanches', { headers: { 'User-Agent': 'WhatsApp' } }),
  ]) {
    const response = await worker.fetch(request, { ASSETS: assets });
    const html = await response.text();
    assert.equal(request.method === 'HEAD' ? html : html.includes('property="og:image"'), request.method === 'HEAD' ? '' : false);
  }
  assert.equal(requests, 0);
  const routes = JSON.parse(readFileSync(new URL('../public/_routes.json', import.meta.url), 'utf8'));
  assert.ok(routes.include.includes('/c/*'), 'Cloudflare must invoke the worker for the tenant cardápio');
});
