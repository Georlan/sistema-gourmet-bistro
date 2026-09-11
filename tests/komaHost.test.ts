import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveKomaHost,
  parseTenantSubdomain,
  getTenantPublicMenuUrl,
  getTenantCaixaUrl,
  getTenantGarcomUrl,
  getOperationalAppUrl,
  isOperationalAppHost,
} from '../src/domain/komaHost.js';

describe('parseTenantSubdomain', () => {
  it('identifies simple tenant public menu', () => {
    const result = parseTenantSubdomain('pordosol');
    assert.deepEqual(result, { slug: 'pordosol', surface: 'public' });
  });

  it('identifies tenant with compound hyphenated slug', () => {
    const result = parseTenantSubdomain('bar-do-sol');
    assert.deepEqual(result, { slug: 'bar-do-sol', surface: 'public' });
  });

  it('identifies caixa operational surface right-to-left for legacy links', () => {
    assert.deepEqual(parseTenantSubdomain('pordosol-caixa'), { slug: 'pordosol', surface: 'caixa' });
    assert.deepEqual(parseTenantSubdomain('bar-do-sol-caixa'), { slug: 'bar-do-sol', surface: 'caixa' });
  });

  it('identifies garcom operational surface right-to-left for legacy links', () => {
    assert.deepEqual(parseTenantSubdomain('pordosol-garcom'), { slug: 'pordosol', surface: 'garcom' });
    assert.deepEqual(parseTenantSubdomain('restaurante-top-garcom'), { slug: 'restaurante-top', surface: 'garcom' });
  });

  it('identifies entregador/motoboy operational surface right-to-left', () => {
    assert.deepEqual(parseTenantSubdomain('pordosol-entregador'), { slug: 'pordosol', surface: 'entregador' });
    assert.deepEqual(parseTenantSubdomain('pordosol-motoboy'), { slug: 'pordosol', surface: 'entregador' });
  });

  it('rejects reserved subdomains', () => {
    assert.equal(parseTenantSubdomain('www'), null);
    assert.equal(parseTenantSubdomain('central'), null);
    assert.equal(parseTenantSubdomain('admin'), null);
    assert.equal(parseTenantSubdomain('api'), null);
    assert.equal(parseTenantSubdomain('app'), null);
  });
});

describe('resolveKomaHost', () => {
  it('resolves apex komafood.com.br root path to landing', () => {
    const resolved = resolveKomaHost('komafood.com.br', '/', '');
    assert.equal(resolved.kind, 'landing');
    assert.equal(resolved.surface, 'landing');
  });

  it('resolves explicit /landing path to landing', () => {
    const resolved = resolveKomaHost('localhost', '/landing', '');
    assert.equal(resolved.kind, 'landing');
    assert.equal(resolved.surface, 'landing');
  });

  it('resolves central.komafood.com.br to central super admin', () => {
    const resolved = resolveKomaHost('central.komafood.com.br', '/', '');
    assert.equal(resolved.kind, 'central');
    assert.equal(resolved.surface, 'central');
  });

  it('resolves /super-admin path to central', () => {
    const resolved = resolveKomaHost('localhost', '/super-admin', '');
    assert.equal(resolved.kind, 'central');
    assert.equal(resolved.surface, 'central');
  });

  it('resolves app.komafood.com.br as generic operational entry without tenant', () => {
    const resolved = resolveKomaHost('app.komafood.com.br', '/', '');
    assert.equal(isOperationalAppHost('app.komafood.com.br'), true);
    assert.equal(resolved.kind, 'generic');
    assert.equal(resolved.surface, 'garcom');
    assert.equal(resolved.tenantSlug, null);
  });

  it('keeps the temporary management bridge tenantless on app.komafood.com.br', () => {
    const resolved = resolveKomaHost('app.komafood.com.br', '/', '?view=caixa');
    assert.equal(resolved.kind, 'generic');
    assert.equal(resolved.surface, 'caixa');
    assert.equal(resolved.tenantSlug, null);
  });

  it('resolves tenant public menu subdomain (e.g. pordosol.komafood.com.br)', () => {
    const resolved = resolveKomaHost('pordosol.komafood.com.br', '/', '');
    assert.equal(resolved.kind, 'tenant');
    assert.equal(resolved.surface, 'public');
    assert.equal(resolved.tenantSlug, 'pordosol');
  });

  it('continues resolving legacy tenant caixa links', () => {
    const resolved = resolveKomaHost('pordosol-caixa.komafood.com.br', '/', '');
    assert.equal(resolved.kind, 'tenant');
    assert.equal(resolved.surface, 'caixa');
    assert.equal(resolved.tenantSlug, 'pordosol');
  });

  it('continues resolving legacy tenant garcom links', () => {
    const resolved = resolveKomaHost('pordosol-garcom.komafood.com.br', '/', '');
    assert.equal(resolved.kind, 'tenant');
    assert.equal(resolved.surface, 'garcom');
    assert.equal(resolved.tenantSlug, 'pordosol');
  });

  it('resolves path-based /c/:slug fallback', () => {
    const resolved = resolveKomaHost('sistema-gourmet-bistro.pages.dev', '/c/pordosol', '');
    assert.equal(resolved.kind, 'tenant');
    assert.equal(resolved.surface, 'public');
    assert.equal(resolved.tenantSlug, 'pordosol');
  });
});

describe('URL generators', () => {
  it('keeps tenant identity only on the public menu URL', () => {
    assert.equal(getTenantPublicMenuUrl('pordosol'), 'https://pordosol.komafood.com.br/');
  });

  it('generates one canonical operational URL for staff', () => {
    assert.equal(getOperationalAppUrl(), 'https://app.komafood.com.br/');
    assert.equal(getTenantCaixaUrl('pordosol'), 'https://app.komafood.com.br/');
    assert.equal(getTenantGarcomUrl('outro-restaurante'), 'https://app.komafood.com.br/');
  });
});
