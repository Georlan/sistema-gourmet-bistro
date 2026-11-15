import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { landingTrafficSource } from '../src/landing/marketingAttribution';

const source = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('landing attribution identifies supported sources without exposing arbitrary UTMs', () => {
  assert.equal(landingTrafficSource('?utm_source=instagram&utm_medium=organic_social&token=secret'), 'instagram');
  assert.equal(landingTrafficSource('?utm_source=cardapio_digital&utm_campaign=restaurant_referral'), 'cardapio_digital');
  assert.equal(landingTrafficSource('?utm_source=john%40example.com', 'https://www.google.com/search?q=koma'), 'other');
  assert.equal(landingTrafficSource('', 'https://l.instagram.com/?u=private'), 'instagram');
  assert.equal(landingTrafficSource('', 'https://www.google.com.br/search?q=koma'), 'google');
  assert.equal(landingTrafficSource('', 'https://www.bing.com/search?q=koma'), 'bing');
  assert.equal(landingTrafficSource('', 'https://m.facebook.com/'), 'facebook');
  assert.equal(landingTrafficSource('', 'https://fakeinstagram.com/'), 'other');
  assert.equal(landingTrafficSource('', 'https://google.com.evil.test/'), 'other');
  assert.equal(landingTrafficSource('', ''), 'direct');
});

test('marketing events are wired at visit, demo opening and confirmed lead only', () => {
  const landing = source('src/landing/LandingPage.tsx');
  const provider = source('src/landing/components/LeadCaptureProvider.tsx');
  const modal = source('src/landing/components/LeadCaptureModal.tsx');
  assert.match(landing, /trackAnalyticsEvent\('landing_viewed'/);
  assert.match(provider, /trackAnalyticsEvent\('landing_demo_opened'/);
  assert.match(modal, /if \(!result\.success\) throw new Error\('capture_failed'\);[\s\S]*trackAnalyticsEvent\('landing_demo_submitted'/);
  for (const file of [landing, provider, modal]) {
    assert.match(file, /currentLandingTrafficSource\(\)/);
  }
  const eventTypes = source('src/analytics/types.ts');
  assert.match(eventTypes, /landing_demo_submitted: \{ traffic_source:/);
  assert.doesNotMatch(eventTypes.match(/landing_demo_submitted: \{[^}]+\}/)?.[0] || '', /nome|telefone|email|whatsapp|referrer|utm_/i);
});

test('the website links the verified brand profile from the public footer', () => {
  const footer = source('src/landing/sections/FinalCTA.tsx');
  assert.match(footer, /href=\{LANDING_SEO\.instagram\}/);
  assert.match(footer, /Instagram oficial/);
  assert.match(footer, /rel="noopener noreferrer"/);
});
