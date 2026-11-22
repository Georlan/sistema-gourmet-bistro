import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT,
  fetchCardapioDigitalConfig,
  getCardapioDigitalConfigCacheStats,
  invalidateCardapioDigitalConfigCache,
  resetCardapioDigitalConfigCacheStats,
  updateCardapioDigitalConfigCache,
} from '../src/components/caixa/online-menu/cardapioDigitalConfigClient';

function withFakeWindow(run: (events: string[]) => Promise<void> | void) {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalEvent = (globalThis as { Event?: unknown }).Event;
  const events: string[] = [];

  class FakeEvent {
    readonly type: string;
    constructor(type: string) {
      this.type = type;
    }
  }

  (globalThis as { Event?: unknown }).Event = FakeEvent;
  (globalThis as { window?: unknown }).window = {
    dispatchEvent(event: { type: string }) {
      events.push(event.type);
      return true;
    },
  };

  return Promise.resolve(run(events)).finally(() => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
    if (originalEvent === undefined) {
      delete (globalThis as { Event?: unknown }).Event;
    } else {
      (globalThis as { Event?: unknown }).Event = originalEvent;
    }
  });
}

test('cardapioDigitalConfigClient contabiliza hits, misses e invalidations sem PII', async () => {
  invalidateCardapioDigitalConfigCache();
  resetCardapioDigitalConfigCacheStats();
  assert.deepEqual(getCardapioDigitalConfigCacheStats(), {
    hits: 0,
    misses: 0,
    invalidations: 0,
  });

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;

  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({
        id: 6,
        slug: 'quentinha-caseira',
        taxa_entrega_fixa: 2,
        tabela_taxas_bairros: [{ bairro: 'Bom Nome', taxa: 2 }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  try {
    // 2 chamadas concorrentes: 1 miss (rede) + 1 hit coalescido
    const [first, second] = await Promise.all([
      fetchCardapioDigitalConfig('https://api.test', 'Bearer tok-6', { restaurantId: 6 }),
      fetchCardapioDigitalConfig('https://api.test', 'Bearer tok-6', { restaurantId: 6 }),
    ]);
    assert.equal(fetchCalls, 1);
    assert.equal(first.slug, 'quentinha-caseira');
    assert.equal(second.slug, 'quentinha-caseira');
    assert.deepEqual(getCardapioDigitalConfigCacheStats(), {
      hits: 1,
      misses: 1,
      invalidations: 0,
    });

    // Chamada sequencial dentro do TTL: hit em memória
    await fetchCardapioDigitalConfig('https://api.test', 'Bearer tok-6');
    assert.equal(fetchCalls, 1);
    assert.deepEqual(getCardapioDigitalConfigCacheStats(), {
      hits: 2,
      misses: 1,
      invalidations: 0,
    });

    // Invalidação limpa cache e incrementa invalidations
    invalidateCardapioDigitalConfigCache();
    assert.deepEqual(getCardapioDigitalConfigCacheStats(), {
      hits: 2,
      misses: 1,
      invalidations: 1,
    });

    // Nova leitura vai para rede (miss)
    await fetchCardapioDigitalConfig('https://api.test', 'Bearer tok-6');
    assert.equal(fetchCalls, 2);
    const stats = getCardapioDigitalConfigCacheStats();
    assert.deepEqual(stats, {
      hits: 2,
      misses: 2,
      invalidations: 1,
    });
    assert.deepEqual(Object.keys(stats).sort(), ['hits', 'invalidations', 'misses']);

    // force: true ignora cache em memória e registra miss
    await fetchCardapioDigitalConfig('https://api.test', 'Bearer tok-6', { force: true });
    assert.equal(fetchCalls, 3);
    assert.deepEqual(getCardapioDigitalConfigCacheStats(), {
      hits: 2,
      misses: 3,
      invalidations: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    invalidateCardapioDigitalConfigCache();
    resetCardapioDigitalConfigCacheStats();
  }
});

test('invalidateCardapioDigitalConfigCache e updateCardapioDigitalConfigCache emitem koma_cardapio_config_updated', async () => {
  assert.equal(CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT, 'koma_cardapio_config_updated');

  await withFakeWindow(async (events) => {
    invalidateCardapioDigitalConfigCache();
    assert.deepEqual(events, [CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT]);

    // Atualização 1-arg sem escopo ativo não emite evento espúrio
    updateCardapioDigitalConfigCache({ frete_gratis_valor: 50 });
    assert.deepEqual(events, [CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT]);

    // Atualização 3-arg cria escopo e emite evento
    updateCardapioDigitalConfigCache('https://api.test', 'Bearer tok-6', {
      frete_gratis_valor: 50,
    });
    assert.deepEqual(events, [
      CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT,
      CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT,
    ]);

    // Atualização 1-arg com escopo ativo também emite evento
    updateCardapioDigitalConfigCache({ frete_gratis_valor: 75 });
    assert.deepEqual(events, [
      CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT,
      CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT,
      CARDAPIO_DIGITAL_CONFIG_UPDATED_EVENT,
    ]);
  });

  // SSR guard: sem window global não deve lançar erro
  assert.equal((globalThis as { window?: unknown }).window, undefined);
  assert.doesNotThrow(() => {
    invalidateCardapioDigitalConfigCache();
    updateCardapioDigitalConfigCache('https://api.test', 'Bearer tok-6', { slug: 'ssr' });
  });
  invalidateCardapioDigitalConfigCache();
  resetCardapioDigitalConfigCacheStats();
});
