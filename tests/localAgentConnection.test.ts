import assert from 'node:assert/strict';
import test from 'node:test';
import { probeLocalAgent, queryLoopbackPermission } from '../src/components/printing/localAgentConnection';

const identity = { service: 'koma-print-agent', status: 'ready', agent_id: 'local-fixture' };
const response = (data = identity) => new Response(JSON.stringify(data));

test('permission API uses loopback and falls back only to the legacy combined permission', async () => {
  const names: string[] = [];
  const permission = { state: 'denied' } as PermissionStatus;
  const api = { query: async ({ name }: PermissionDescriptor) => {
    names.push(name);
    if (String(name) === 'loopback-network') throw new TypeError('unsupported');
    return permission;
  }};
  assert.equal(await queryLoopbackPermission(api), permission);
  assert.deepEqual(names, ['loopback-network', 'local-network-access']);
  assert.equal(await queryLoopbackPermission(undefined), null);
  assert.equal(await queryLoopbackPermission({ query: async () => { throw new TypeError('old browser'); } }), null);
});

for (const permission of ['prompt', 'denied'] as const) {
  test(`background discovery with ${permission} never probes local ports`, async () => {
    let calls = 0;
    const result = await probeLocalAgent({ permission, fetcher: async () => { calls++; return response(); } });
    assert.equal(result.status, permission === 'denied' ? 'permission_denied' : 'permission_prompt');
    assert.equal(calls, 0);
    assert.equal(result.identity, null);
  });
}

test('an explicit click cannot override a denied permission', async () => {
  let calls = 0;
  assert.equal((await probeLocalAgent({ permission: 'denied', interactive: true,
    fetcher: async () => { calls++; return response(); } })).status, 'permission_denied');
  assert.equal(calls, 0);
});

for (const permission of ['granted', 'unsupported'] as const) {
  test(`${permission} preserves compatible identity discovery across the existing port range`, async () => {
    const urls: string[] = [];
    const result = await probeLocalAgent({ permission, fetcher: async (url, options) => {
      urls.push(String(url));
      assert.equal(options?.method ?? 'GET', 'GET');
      assert.equal((options as RequestInit & {targetAddressSpace: string}).targetAddressSpace, 'loopback');
      assert.equal(options?.cache, 'no-store');
      if (String(url).includes(':17659/')) return response();
      throw new TypeError('connection refused');
    }});
    assert.equal(result.status, 'ready');
    assert.equal(result.identity?.agent_id, 'local-fixture');
    assert.equal(urls.length, 11);
    assert.ok(urls.every(url => /^http:\/\/127\.0\.0\.1:176\d{2}\/agent\/identity$/.test(url)));
  });
}

test('connection waits for the user permission dialog beyond the old background deadline', async () => {
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const pending = probeLocalAgent({ permission: 'prompt', interactive: true, fetcher: async (url, options) => {
    if (!String(url).includes(':17654/')) throw new TypeError('closed port');
    await delayed;
    assert.equal(options?.signal?.aborted, false);
    return response();
  }});
  await new Promise(resolve => setTimeout(resolve, 550));
  release();
  assert.equal((await pending).status, 'ready');
});

test('invalid services and empty identities cannot authorize another computer', async () => {
  const bad = [ { ...identity, service: 'other' }, { ...identity, agent_id: ' ' }, { ...identity, status: 'starting' } ];
  for (const value of bad) {
    const result = await probeLocalAgent({ permission: 'granted', fetcher: async () => response(value) });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.identity, null);
  }
});

test('aborting a scope cancels all reads and never adopts a late identity', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const signals: AbortSignal[] = [];
  const pending = probeLocalAgent({ permission: 'granted', signal: controller.signal, fetcher: async (_url, options) => {
    signals.push(options!.signal!);
    await delayed;
    return response();
  }});
  controller.abort(); release();
  assert.equal((await pending).identity, null);
  assert.ok(signals.every(signal => signal.aborted));
});

test('nonresponsive discovery has a bounded deadline and releases its requests', async () => {
  const result = await probeLocalAgent({ permission: 'granted', timeoutMs: 5,
    fetcher: async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }) });
  assert.equal(result.status, 'unavailable');
});

test('an immediate valid identity does not wait for unrelated hanging ports', { timeout: 1500 }, async context => {
  const controller = new AbortController();
  context.after(() => controller.abort());
  const hanging: AbortSignal[] = [];
  const result = await probeLocalAgent({ permission: 'granted', interactive: true, signal: controller.signal,
    fetcher: async (url, options) => {
      if (String(url).includes(':17654/')) return response();
      hanging.push(options!.signal!);
      return new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      });
    } });
  assert.equal(result.status, 'ready');
  assert.ok(hanging.every(signal => signal.aborted));
});
