import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchCaixaConfiguracoes,
  invalidateCaixaConfiguracoesCache,
} from '../src/utils/caixaConfigClient';
import {
  fetchOnlineOrdersControl,
  invalidateOnlineOrdersControlCache,
} from '../src/components/caixa/online-menu/onlineOrdersControlClient';

test('fetchCaixaConfiguracoes coalesce chamadas concorrentes e sequenciais dentro do TTL', async () => {
  invalidateCaixaConfiguracoesCache();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ restaurante_id: 1, taxa_servico_ativa: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const [a, b] = await Promise.all([
      fetchCaixaConfiguracoes('http://127.0.0.1:8000', { Authorization: 'Bearer tok-1' }),
      fetchCaixaConfiguracoes('http://127.0.0.1:8000', { Authorization: 'Bearer tok-1' }),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.ok, true);
    assert.equal(b.data?.restaurante_id, 1);

    // Chamada subsequente após conclusão ainda reaproveita o cache curto
    const c = await fetchCaixaConfiguracoes('http://127.0.0.1:8000', { Authorization: 'Bearer tok-1' });
    assert.equal(calls, 1);
    assert.equal(c.data?.taxa_servico_ativa, true);

    // Force ou invalidação dispara nova requisição
    const d = await fetchCaixaConfiguracoes(
      'http://127.0.0.1:8000',
      { Authorization: 'Bearer tok-1' },
      { force: true },
    );
    assert.equal(calls, 2);
    assert.equal(d.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCaixaConfiguracoesCache();
  }
});

test('fetchOnlineOrdersControl coalesce chamadas concorrentes e invalida após mutação', async () => {
  invalidateOnlineOrdersControlCache();
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(JSON.stringify({ paused: false, auto_accept: true, counts: { active: 2 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const [a, b] = await Promise.all([
      fetchOnlineOrdersControl('http://127.0.0.1:8000', 'Bearer tok-2'),
      fetchOnlineOrdersControl('http://127.0.0.1:8000', 'Bearer tok-2'),
    ]);
    assert.equal(calls, 1);
    assert.equal(a.payload?.auto_accept, true);
    assert.equal(b.payload?.counts?.active, 2);

    invalidateOnlineOrdersControlCache();
    await fetchOnlineOrdersControl('http://127.0.0.1:8000', 'Bearer tok-2');
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateOnlineOrdersControlCache();
  }
});
