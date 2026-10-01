import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Exercise the actual build artifact with the existing browser infrastructure.
// Cloudflare host selection is covered separately by publicSeo.test.ts.
const artifact = () => readFile(new URL('../dist/seo-landing.html', import.meta.url), 'utf8');

test('public landing is readable and styled without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.route(`${baseURL}/`, route => artifact().then(body => route.fulfill({ contentType: 'text/html', body })));
  await page.goto(baseURL!);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/KÔMA.*Sistema para restaurantes/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://komafood.com.br/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /PDV, mesas, comandas/);
  const images = await page.locator('img').evaluateAll<{ src: string | null; loaded: boolean }[], HTMLImageElement>(elements => elements.map(element => ({ src: element.getAttribute('src'), loaded: element.complete && element.naturalWidth > 0 })));
  expect(images.length).toBeGreaterThan(5);
  expect(images.every(image => !image.src?.startsWith('/src/assets/'))).toBe(true);
  expect(images.filter(image => !image.loaded)).toEqual([]);
  expect(await page.locator('h1').evaluate(element => getComputedStyle(element).fontSize)).not.toBe('32px');
  await context.close();
});

test('prerendered public landing boots the interactive application', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`${baseURL}/`, route => artifact().then(body => route.fulfill({ contentType: 'text/html', body })));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('tab').first()).toBeVisible();
  await page.getByRole('tab').nth(1).click();
  await expect(page.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
  await expect(page.locator('#koma-software-schema')).toHaveCount(1);
});
