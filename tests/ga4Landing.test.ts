import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function simulateGa4(url: string, referrer = '', measurementId = 'G-71DWSMX2JM') {
  const appended: Array<{ src?: string; async?: boolean }> = [];
  const browserWindow: Record<string, any> = { location: new URL(url) };
  const fakeDocument = {
    title: 'KÔMA — Sistema para restaurantes',
    referrer,
    currentScript: { dataset: { measurementId } },
    createElement: (_name: string) => ({ src: '', async: false }),
    head: { appendChild: (element: { src?: string; async?: boolean }) => appended.push(element) },
  };
  const context = { window: browserWindow, document: fakeDocument, URL, URLSearchParams, Date, encodeURIComponent };
  runInNewContext(source('public/ga4-landing.js'), context);
  return { appended, browserWindow, context };
}

test('public GA4 ID comes from tracked non-secret config with a build override', () => {
  const config = JSON.parse(source('src/landing/config/publicMarketingAnalytics.json'));
  assert.equal(config.ga4MeasurementId, 'G-71DWSMX2JM');
  const build = source('scripts/prerenderLanding.ts');
  assert.match(build, /process\.env\.VITE_GA4_MEASUREMENT_ID/);
  assert.match(build, /<script defer src="\/ga4-landing\.js" data-measurement-id=/);
  assert.doesNotMatch(source('index.html'), /ga4-landing|googletagmanager|G-71DWSMX2JM/,
    'shared operational shell must not load GA4');
});

test('public GA4 strips unknown query strings and referrer paths while retaining Instagram campaign', () => {
  const { appended, browserWindow } = simulateGa4(
    'https://komafood.com.br/?utm_source=instagram&utm_medium=organic_social&utm_campaign=perfil&email=private%40example.com&token=secret',
    'https://l.instagram.com/private/path?access_token=secret',
  );
  assert.equal(appended.length, 1);
  assert.equal(appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-71DWSMX2JM');
  assert.equal(appended[0].async, true);
  const events = browserWindow.dataLayer as IArguments[];
  assert.equal(events.length, 2);
  assert.equal(events[1][0], 'config');
  assert.equal(events[1][1], 'G-71DWSMX2JM');
  assert.equal(events[1][2].page_location,
    'https://komafood.com.br/?utm_source=instagram&utm_medium=organic_social&utm_campaign=perfil');
  assert.equal(events[1][2].page_referrer, 'https://l.instagram.com/');
  assert.equal(events[1][2].allow_google_signals, false);
  assert.equal(events[1][2].allow_ad_personalization_signals, false);
  assert.equal(events[1][2].send_page_view, true);
});

test('GA4 is disabled on operational, preview and www hosts and invalid IDs', () => {
  for (const url of ['https://app.komafood.com.br/', 'https://central.komafood.com.br/',
    'https://admin.komafood.com.br/', 'https://preview.pages.dev/', 'http://localhost:3000/',
    'https://www.komafood.com.br/']) {
    const { appended, browserWindow } = simulateGa4(url);
    assert.equal(appended.length, 0, url);
    assert.equal(browserWindow.dataLayer, undefined, url);
  }
  const invalid = simulateGa4('https://komafood.com.br/', '', 'G-INVALID<script>');
  assert.equal(invalid.appended.length, 0);
});
