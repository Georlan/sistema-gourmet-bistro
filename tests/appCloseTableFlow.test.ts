import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const commandSource = readFileSync(
  new URL('../src/components/app/data/operationalOrderCommands.ts', import.meta.url),
  'utf8',
);
const start = appSource.indexOf('const handleCloseTable = async');
const end = appSource.indexOf('// 9.5. Clear Table Orders', start);

assert.ok(start >= 0, 'handleCloseTable precisa existir');
assert.ok(end > start, 'bloco handleCloseTable precisa estar delimitado');

const closeBlock = appSource.slice(start, end);

test('table close accepts management roles or explicit waiter close permission instead of caixa-only gate', () => {
  assert.match(closeBlock, /if \(!isManagementRole\(activeRole\)\)/);
  assert.match(closeBlock, /if \(!restauranteConfig\?\.perm_garcom_fechar\)/);
  assert.doesNotMatch(closeBlock, /activeRole\s*!==\s*['"]caixa['"]/);
  assert.match(closeBlock, /const opKey = `close-\$\{mesaId\}`/);
});

test('table close delegates transport to command owner and waits for backend authority', () => {
  const requestIndex = closeBlock.indexOf('const result = await closeOperationalComandas');
  const failureIndex = closeBlock.indexOf('if (!result.ok)', requestIndex);
  const successIndex = closeBlock.indexOf('showToast(`Mesa ${mesaId} encerrada e liberada.`');

  assert.ok(requestIndex >= 0, 'fechamento deve delegar ao owner de comandos');
  assert.ok(failureIndex > requestIndex, 'resultado do backend deve ser validado');
  assert.ok(successIndex > failureIndex, 'sucesso só pode ser anunciado após validar respostas');
  assert.doesNotMatch(closeBlock.slice(0, requestIndex), /encerrada e liberada/);
  assert.doesNotMatch(closeBlock, /setOrders\(/, 'não remover mesa localmente antes da confirmação');
  assert.match(closeBlock, /await fetchOrdersFromAPI\(\)/);

  assert.match(commandSource, /for \(const comandaId of comandaIds\)/);
  assert.match(commandSource, /await operationalFetch/);
  assert.match(commandSource, /if \(!response.ok\)/);
  assert.match(commandSource, /return \{ ok: false, message:/);
  assert.match(commandSource, /return \{ ok: true \}/);
});

test('item cancellation, edit, and transfer wait for backend confirmation before mutating state or showing success toast', () => {
  const cancelStart = appSource.indexOf('const handleCancelItem = async');
  const cancelEnd = appSource.indexOf('const handleUpdateItemDetails = async', cancelStart);
  const cancelBlock = appSource.slice(cancelStart, cancelEnd);

  const cancelReqIdx = cancelBlock.indexOf('const result = await cancelOperationalItem');
  const cancelFailIdx = cancelBlock.indexOf('if (!result.ok)', cancelReqIdx);
  const cancelToastIdx = cancelBlock.indexOf("showToast('Item cancelado.', 'success')");
  assert.ok(cancelReqIdx >= 0, 'handleCancelItem deve delegar para cancelOperationalItem');
  assert.doesNotMatch(cancelBlock, /setOrders\(/, 'handleCancelItem não deve mutar estado otimista antes da confirmação do backend');
  assert.ok(cancelFailIdx > cancelReqIdx, 'resultado do backend deve ser verificado antes de confirmar sucesso');
  assert.ok(cancelToastIdx > cancelFailIdx, 'handleCancelItem só deve exibir toast de sucesso após confirmação do backend');

  assert.match(commandSource, /export async function cancelOperationalItem/);
  assert.match(commandSource, /export async function updateOperationalItemDetails/);
  assert.match(commandSource, /export async function transferOperationalItems/);
});

test('transferOperationalItems uses a single atomic batch request and MesaDetailsModal does not duplicate the fetch', async () => {
  const { transferOperationalItems, updateOperationalItemDetails } = await import(
    '../src/components/app/data/operationalOrderCommands'
  );
  const modalAdapterSource = readFileSync(new URL('../src/components/MesaDetailsModal.tsx', import.meta.url), 'utf8');
  const modalBaseSource = readFileSync(new URL('../src/components/MesaDetailsModalBase.tsx', import.meta.url), 'utf8');

  assert.doesNotMatch(
    modalAdapterSource,
    /\/comandas\/itens\/transferir-lote\//,
    'MesaDetailsModal não deve disparar requisição duplicada sem validar resposta antes de onTransferItems',
  );
  assert.doesNotMatch(
    commandSource,
    /\/comandas\/itens\/\$\{encodeURIComponent\(itemId\)\}\/transferir\//,
    'transferOperationalItems não deve fazer loop item a item não-atômico',
  );
  assert.match(
    commandSource,
    /\/comandas\/itens\/transferir-lote\/\$\{targetTableId\}/,
    'transferOperationalItems deve usar o endpoint transacional em lote',
  );
  assert.match(
    modalBaseSource,
    /if \(updated === false\) \{[\s\S]*?setEditingItem\(\(prev: any\) => prev \? \{ \.\.\.prev, isSaving: false \} : prev\);\s*return;\s*\}/,
    'MesaDetailsModalBase deve manter o modal aberto e preservar os campos digitados quando onUpdateItemDetails retorna false',
  );

  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, method: init?.method, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url.includes('/transferir-lote/9')) {
        return new Response(JSON.stringify({ detail: 'Itens pagos não podem ser transferidos' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/comandas/itens/item-err')) {
        return new Response(JSON.stringify({ detail: 'A observação não pode ser alterada após o preparo' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify([{ id: 'item-1' }, { id: 'item-2' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const okBatch = await transferOperationalItems(['item-1', 'item-2', 'item-1'], 8, () => ({ Authorization: 'Bearer t' }));
    assert.deepEqual(okBatch, { ok: true });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/comandas\/itens\/transferir-lote\/8$/);
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].body!), { item_ids: ['item-1', 'item-2'] });

    const failBatch = await transferOperationalItems(['item-1', 'item-2'], 9, () => ({ Authorization: 'Bearer t' }));
    assert.deepEqual(failBatch, { ok: false, message: 'Itens pagos não podem ser transferidos' });
    assert.equal(calls.length, 2);

    const failEdit = await updateOperationalItemDetails(
      { itemId: 'item-err', observacao: 'Sem sal', clienteNome: 'Maria', quantidadeAdicional: 2 },
      () => ({ Authorization: 'Bearer t' }),
    );
    assert.deepEqual(failEdit, { ok: false, message: 'A observação não pode ser alterada após o preparo' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});


