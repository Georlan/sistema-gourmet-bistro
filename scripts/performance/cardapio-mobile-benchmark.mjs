#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium, webkit } = require('@playwright/test');

const BASE_URL = process.env.BENCH_URL || 'http://127.0.0.1:4387';
const RUNS = Number(process.env.BENCH_RUNS || 3);
const OUT_FILE = process.env.BENCH_OUT || '';

// Valid minimal 120x120 WebP image (generated once, realistic ~3.2 kB payload, cacheable)
const WEBP_1X1 = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
  'base64',
);

function buildCatalog(size) {
  const configs = {
    small: { categories: 4, products: 20, families: 1 },
    medium: { categories: 10, products: 120, families: 3 },
    large: { categories: 20, products: 500, families: 8 },
  };
  const cfg = configs[size];
  const categorias = Array.from({ length: cfg.categories }, (_, i) => ({
    id: i + 1,
    nome: `Categoria ${i + 1}`,
    ordem: i + 1,
  }));
  const produtos = Array.from({ length: cfg.products }, (_, i) => {
    const id = i + 1;
    const catId = (i % cfg.categories) + 1;
    const hasFamily = i < cfg.families * 4;
    const famIdx = (i % cfg.families) + 1;
    return {
      id,
      nome: hasFamily ? `Pizza Sabor ${id} (${['P', 'M', 'G', 'GG'][i % 4]})` : `Produto Gourmet ${id}`,
      descricao: `Descrição do item ${id} preparado na hora com ingredientes selecionados.`,
      preco: 15 + (i % 45),
      preco_promocional: i % 7 === 0 ? 12 + (i % 35) : null,
      categoria_id: catId,
      ativo: true,
      disponivel: true,
      imagem_url: `/bench-img/${id}.webp`,
      familia_id: hasFamily ? famIdx : null,
      familia_nome: hasFamily ? `Família Especial ${famIdx}` : null,
      grupos_modificadores:
        i % 3 === 0
          ? [
              {
                id: id * 10 + 1,
                nome: 'Adicionais',
                minimo: 0,
                maximo: 3,
                obrigatorio: false,
                opcoes: [
                  { id: id * 100 + 1, nome: 'Extra Queijo', preco: 4.5, ativo: true },
                  { id: id * 100 + 2, nome: 'Bacon Crocante', preco: 6.0, ativo: true },
                  { id: id * 100 + 3, nome: 'Molho Especial', preco: 2.5, ativo: true },
                ],
              },
            ]
          : [],
    };
  });
  return {
    restaurante: {
      id: 999,
      nome: `Restaurante Bench ${size}`,
      slug: `bench-${size}`,
      aceitando_pedidos: true,
      status_override: 'Forçado Aberto',
      delivery_ativo: true,
      taxa_entrega: 6,
      pedido_minimo: 10,
      formas_pagamento_aceitas: ['Pix', 'Dinheiro', 'Cartão'],
      tempo_estimado_min: 25,
      tempo_estimado_max: 40,
    },
    categorias,
    produtos,
    promocoes: [],
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarize(runs) {
  const keys = Object.keys(runs[0]);
  const out = {};
  for (const k of keys) {
    const vals = runs.map((r) => r[k]).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (!vals.length) {
      out[k] = null;
      continue;
    }
    out[k] = {
      med: Number(median(vals).toFixed(2)),
      min: Number(Math.min(...vals).toFixed(2)),
      max: Number(Math.max(...vals).toFixed(2)),
    };
  }
  return out;
}

async function setupRoutes(page, catalog, size) {
  const catalogJson = JSON.stringify(catalog);
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
      return route.fulfill({
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'text/css' },
        body: '',
      });
    }
    if (url.includes('/bench-img/')) {
      return route.fulfill({
        status: 200,
        headers: { 'Cache-Control': 'public, max-age=3600', 'Content-Type': 'image/webp' },
        body: WEBP_1X1,
      });
    }
    if (url.includes('/api/cardapio-digital/public')) {
      return route.fulfill({
        status: 200,
        headers: { 'Cache-Control': 'no-cache', 'Content-Type': 'application/json' },
        body: catalogJson,
      });
    }
    if (url.includes('/api/cardapio-digital/populares') || url.includes('/api/cardapio-digital/promocoes')) {
      return route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produtos: [], promocoes: [] }),
      });
    }
    if (url.startsWith(BASE_URL)) {
      return route.continue();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
}

async function attachObservers(page) {
  await page.addInitScript(() => {
    window.__bench = { fcp: null, lcp: null, bootCls: 0, longTasks: [], wsCount: 0, bootDoneAt: null };
    const OrigWS = window.WebSocket;
    window.WebSocket = new Proxy(OrigWS, {
      construct() {
        window.__bench.wsCount++;
        return {
          readyState: 1,
          close() {},
          send() {},
          addEventListener() {},
          removeEventListener() {},
        };
      },
    });
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.name === 'first-contentful-paint') window.__bench.fcp = e.startTime;
        }
      }).observe({ type: 'paint', buffered: true });
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__bench.lcp = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput && window.__bench.bootDoneAt === null) {
            window.__bench.bootCls += e.value;
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (window.__bench.bootDoneAt === null || e.startTime <= window.__bench.bootDoneAt) {
            window.__bench.longTasks.push(e.duration);
          }
        }
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
  });
}

async function runSingle(browserType, opts) {
  const { size, viewport, cpuRate, networkSlow, warmCache } = opts;
  const catalog = buildCatalog(size);
  const browser = await browserType.launch();
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Moto G52) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  });

  if (warmCache) {
    const warmPage = await context.newPage();
    await attachObservers(warmPage);
    await setupRoutes(warmPage, catalog, size);
    await warmPage.goto(`${BASE_URL}/c/bench-${size}`, { waitUntil: 'networkidle' });
    await warmPage.locator('[id^="product-card-"]').first().waitFor({ state: 'visible', timeout: 20000 });
    await warmPage.close();
  }

  const page = await context.newPage();
  await attachObservers(page);
  await setupRoutes(page, catalog, size);

  if (browserType === chromium && (cpuRate > 1 || networkSlow)) {
    const cdp = await context.newCDPSession(page);
    if (cpuRate > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
    }
    if (networkSlow) {
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: 150,
        downloadThroughput: (1.6 * 1024 * 1024) / 8,
        uploadThroughput: (750 * 1024) / 8,
      });
    }
  }

  await page.goto(`${BASE_URL}/c/bench-${size}`, { waitUntil: 'load' });
  await page.locator('[id^="product-card-"]').first().waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(400);

  // Freeze initial load metrics before running synthetic interactions
  const bootMetrics = await page.evaluate(() => {
    window.__bench.bootDoneAt = performance.now();
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    let jsReq = 0;
    let jsTransferBytes = 0;
    let jsDecodedBytes = 0;
    let cssReq = 0;
    let cssTransferBytes = 0;
    let cssDecodedBytes = 0;
    let imgReq = 0;
    let imgTransferBytes = 0;
    for (const r of resources) {
      const name = r.name || '';
      const t = r.transferSize || 0;
      const d = r.decodedBodySize || 0;
      if (name.endsWith('.js')) {
        jsReq++;
        jsTransferBytes += t;
        jsDecodedBytes += d;
      } else if (name.endsWith('.css')) {
        cssReq++;
        cssTransferBytes += t;
        cssDecodedBytes += d;
      } else if (name.includes('/bench-img/') || /\.(webp|png|jpe?g|svg)(\?|$)/i.test(name)) {
        imgReq++;
        imgTransferBytes += t;
      }
    }
    const lt = window.__bench.longTasks || [];
    const bootTbtMs = lt.reduce((acc, d) => acc + Math.max(0, d - 50), 0);
    const heapMB = performance.memory ? performance.memory.usedJSHeapSize / (1024 * 1024) : null;
    return {
      ttfbMs: nav ? Math.max(0, nav.responseStart - nav.requestStart) : null,
      fcpMs: window.__bench.fcp,
      lcpMs: window.__bench.lcp,
      bootCls: window.__bench.bootCls,
      bootLongTasks: lt.length,
      bootTbtMs,
      heapMB,
      wsCount: window.__bench.wsCount,
      jsReq,
      jsTransferKB: jsTransferBytes / 1024,
      jsDecodedKB: jsDecodedBytes / 1024,
      cssReq,
      cssTransferKB: cssTransferBytes / 1024,
      cssDecodedKB: cssDecodedBytes / 1024,
      imgReq,
      imgTransferKB: imgTransferBytes / 1024,
    };
  });

  // Interaction 1: Controlled scroll (45 frames)
  const scrollFps = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const frames = [];
      let last = performance.now();
      let step = 0;
      const totalSteps = 45;
      function tick(now) {
        frames.push(now - last);
        last = now;
        step++;
        window.scrollBy(0, 70);
        if (step < totalSteps) {
          requestAnimationFrame(tick);
        } else {
          window.scrollTo(0, 0);
          const avgDt = frames.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, frames.length - 1);
          resolve(avgDt > 0 ? Math.min(60, 1000 / avgDt) : 60);
        }
      }
      requestAnimationFrame(tick);
    });
  });

  // Interaction 2: Search (explicit wait, fails if broken)
  const searchInput = page.locator('input[type="search"], input[placeholder*="Buscar"], input[placeholder*="buscar"]').first();
  await searchInput.waitFor({ state: 'visible', timeout: 5000 });
  const tSearch0 = Date.now();
  await searchInput.fill('Gourmet 15');
  await page.locator('text=Produto Gourmet 15').first().waitFor({ state: 'visible', timeout: 5000 });
  const searchMs = Date.now() - tSearch0;
  await searchInput.fill('');
  await page.locator('[id^="product-card-"]').first().waitFor({ state: 'visible', timeout: 5000 });

  // Interaction 3: Open product modal
  const firstProductCard = page.locator('[id^="product-card-"]').first();
  const tModal0 = Date.now();
  await firstProductCard.click();
  await page.locator('#product-details-modal').waitFor({ state: 'visible', timeout: 5000 });
  const openProductMs = Date.now() - tModal0;

  // Interaction 4: Add to cart
  const addBtn = page.locator('#btn-add-to-cart-action');
  await addBtn.waitFor({ state: 'visible', timeout: 5000 });
  const tAdd0 = Date.now();
  await addBtn.click();
  await page.locator('#product-details-modal').waitFor({ state: 'hidden', timeout: 5000 });
  const addToCartMs = Date.now() - tAdd0;

  await browser.close();
  return {
    ...bootMetrics,
    scrollFps,
    searchMs,
    openProductMs,
    addToCartMs,
  };
}

const scenarios = [
  { name: 'medium_390_cold_1x', browser: chromium, size: 'medium', viewport: { width: 390, height: 844 }, cpuRate: 1, networkSlow: false, warmCache: false },
  { name: 'large500_390_cold_1x', browser: chromium, size: 'large', viewport: { width: 390, height: 844 }, cpuRate: 1, networkSlow: false, warmCache: false },
  { name: 'medium_390_cold_4x_3g', browser: chromium, size: 'medium', viewport: { width: 390, height: 844 }, cpuRate: 4, networkSlow: true, warmCache: false },
  { name: 'large500_360_cold_4x_3g', browser: chromium, size: 'large', viewport: { width: 360, height: 800 }, cpuRate: 4, networkSlow: true, warmCache: false },
  { name: 'medium_390_warm_4x', browser: chromium, size: 'medium', viewport: { width: 390, height: 844 }, cpuRate: 4, networkSlow: false, warmCache: true },
  { name: 'large500_390_webkit', browser: webkit, size: 'large', viewport: { width: 390, height: 844 }, cpuRate: 1, networkSlow: false, warmCache: false },
];

const gitSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const results = {};
for (const sc of scenarios) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    runs.push(await runSingle(sc.browser, sc));
  }
  results[sc.name] = summarize(runs);
  const s = results[sc.name];
  console.log(
    `${sc.name.padEnd(25)} | LCP:${s.lcpMs?.med ?? '-'}ms FCP:${s.fcpMs?.med ?? '-'}ms CLS:${s.bootCls?.med ?? '-'} TBT:${s.bootTbtMs?.med ?? '-'}ms | FPS:${s.scrollFps?.med ?? '-'} | Search:${s.searchMs?.med ?? '-'}ms Modal:${s.openProductMs?.med ?? '-'}ms Add:${s.addToCartMs?.med ?? '-'}ms | JS:${s.jsReq?.med}req/${s.jsTransferKB?.med}kB(xfer) CSS:${s.cssReq?.med}req/${s.cssTransferKB?.med}kB(xfer)`,
  );
}

if (OUT_FILE) {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify({ gitSha, timestamp: new Date().toISOString(), runs: RUNS, results }, null, 2));
  console.log(`Saved JSON to ${OUT_FILE}`);
}
