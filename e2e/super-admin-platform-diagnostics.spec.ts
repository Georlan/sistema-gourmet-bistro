import { expect, test } from '@playwright/test';

test('plataforma distingue acesso opcional e verifica Telegram somente por leitura', async ({ page }) => {
  let dnsReads = 0;
  let githubReads = 0;
  let telegramReads = 0;
  let writes = 0;
  let telegramFailed = false;
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    if (route.request().method() !== 'GET') writes++;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/integrations/health')) return route.fulfill({ json: {
      database: { status: 'available', latency_ms: 125 }, railway: { status: 'not_configured', hosting_detected: true },
      cloudflare: { status: 'not_configured' }, evolution: { status: 'degraded', details: { details: 'Aguardando conexão' } },
    } });
    if (path.endsWith('/cloudflare/dns')) { dnsReads++; return route.fulfill({ status: 503, json: {} }); }
    if (path.endsWith('/github/runs')) {
      githubReads++;
      return route.fulfill({ json: { workflow_runs: [{ id: 1, name: 'Merge verdict', status: 'completed', conclusion: 'success', head_branch: 'main', head_sha: '123456789012abcdef', created_at: '2026-10-03T12:00:00Z' }] } });
    }
    if (path.endsWith('/credentials')) return route.fulfill({ json: { railway: { configured: false }, cloudflare: { configured: false }, github: { configured: false }, telegram: { configured: true } } });
    if (path.endsWith('/telegram/health')) {
      telegramReads++;
      if (telegramFailed) return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
      return route.fulfill({ json: { status: 'verified', checks: { bot: 'verified', destination: 'verified', membership: 'verified' }, checked_at: '2026-10-03T12:00:00Z', detail: 'Bot, destino e participação verificados por leitura.', delivery_status: 'not_tested' } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok', commit: 'real-sha', version: '3.5' } }));
  await page.goto('/super-admin');
  if (await page.getByRole('button', { name: 'Abrir menu lateral' }).isVisible()) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Plataforma', exact: true }).click();
  await expect(page.getByText('Runtime Railway identificado')).toBeVisible();
  await expect(page.getByText('Respondendo (live)')).toBeVisible();
  await expect(page.getByText('Merge verdict', { exact: true })).toBeVisible();
  await expect(page.getByText('main · 123456789012')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reiniciar backend' })).toHaveCount(0);
  await expect(page.getByText('DNS Cloudflare', { exact: true })).toHaveCount(0);
  expect(dnsReads).toBe(0);
  expect(githubReads).toBe(1);
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await expect(page.getByText('Acesso opcional não habilitado')).toHaveCount(3);
  expect(telegramReads).toBe(0);
  await page.getByRole('button', { name: 'Verificar Telegram', exact: true }).click();
  await expect(page.getByText('Bot e destino verificados', { exact: true })).toBeVisible();
  await expect(page.getByText('Entrega de mensagens: não testada.')).toBeVisible();
  expect(telegramReads).toBe(1);
  telegramFailed = true;
  await page.getByRole('button', { name: 'Verificar Telegram', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Diagnóstico não confirmado');
  await expect(page.getByText('Bot e destino verificados', { exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});


test('integrações distingue não verificado e remove resultados antigos após falha', async ({ page }) => {
  let failed = false;
  await page.addInitScript(() => sessionStorage.setItem('koma_super_admin_token', 'e2e-token'));
  await page.route('**/api/super-admin/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/restaurantes')) return route.fulfill({ json: [] });
    if (path.endsWith('/contracts')) return route.fulfill({ json: { items: [], pendingCount: 0 } });
    if (path.endsWith('/integrations/registry')) {
      if (failed) return route.fulfill({ status: 503, json: { detail: 'Consulta indisponível' } });
      return route.fulfill({ json: { checked_at: '2026-10-07T04:00:00Z', services: [
        { id: 'posthog', name: 'PostHog', category: 'product_analytics', purpose: 'Análise de produto', status: 'unverified', configured: false, latency_ms: null, last_checked_at: null, console_url: 'https://us.posthog.com/project/648305', detail: 'Links disponíveis; projeto não verificado' },
        { id: 'linear', name: 'Linear', category: 'control_plane', purpose: 'Engenharia', status: 'connected', configured: true, latency_ms: 20, last_checked_at: '2026-10-07T04:00:00Z', console_url: 'https://linear.app', detail: 'Acesso verificado' },
      ] } });
    }
    return route.fulfill({ json: {} });
  });
  await page.route('**/health/live', route => route.fulfill({ json: { status: 'ok' } }));
  await page.goto('/super-admin');
  if (await page.getByRole('button', { name: 'Abrir menu lateral' }).isVisible()) await page.getByRole('button', { name: 'Abrir menu lateral' }).click();
  await page.getByRole('button', { name: 'Plataforma', exact: true }).click();
  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Integrações da plataforma' })).toBeVisible();
  await expect(page.locator('div.rounded-xl').filter({ has: page.getByRole('heading', { name: 'PostHog', exact: true }) }).getByText('Não verificado', { exact: true })).toBeVisible();
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
  failed = true;
  await page.getByRole('button', { name: 'Testar conexões agora' }).click();
  await expect(page.getByText('Conectado', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'PostHog', exact: true })).toHaveCount(0);
  await expect(page.getByText('Último probe:', { exact: false })).toHaveCount(0);
});
