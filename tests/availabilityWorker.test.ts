import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTelegramMessage,
  evaluateTransition,
  runScheduledCheck,
} from '../ops/availability-worker/src/index.mjs';

function makeKvStore() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function healthyFetcher(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  return async (url: string | URL) => {
    const target = String(url);
    for (const [needle, handler] of Object.entries(overrides)) {
      if (target.includes(needle)) return handler();
    }
    if (target.endsWith('/health/ready')) {
      return new Response(
        JSON.stringify({
          database: 'healthy',
          db_pool: { wait_timeouts_total: 0, wait_ms: { p95: 15 } },
          websocket: { transport_connected: true },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (target.endsWith('/health/live')) {
      return new Response(JSON.stringify({ status: 'alive' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (target.includes('api.telegram.org')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  };
}

test('availability worker stays UP and sends zero alerts when healthy', async () => {
  const kv = makeKvStore();
  let telegramCalls = 0;
  const result = await runScheduledCheck(
    { MONITOR_STATE: kv, TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '12345' },
    {
      fetcher: healthyFetcher({
        'api.telegram.org': () => {
          telegramCalls += 1;
          return new Response('{}', { status: 200 });
        },
      }),
      sleep: async () => {},
      retestDelayMs: 15000,
      now: () => 1_000_000,
    },
  );
  assert.equal(result.status, 'UP');
  assert.equal(result.retested, false);
  assert.equal(result.shouldAlert, false);
  assert.equal(telegramCalls, 0);
});

test('availability worker retests after 15s and suppresses transient failures that self-recover', async () => {
  const kv = makeKvStore();
  const sleepCalls: number[] = [];
  let readyAttempt = 0;

  const result = await runScheduledCheck(
    { MONITOR_STATE: kv, TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_CHAT_ID: '12345' },
    {
      fetcher: healthyFetcher({
        '/health/ready': () => {
          readyAttempt += 1;
          if (readyAttempt === 1) return new Response('bad gateway', { status: 502 });
          return new Response(
            JSON.stringify({
              database: 'healthy',
              db_pool: { wait_timeouts_total: 0, wait_ms: { p95: 10 } },
              websocket: { transport_connected: true },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      }),
      sleep: async (ms: number) => { sleepCalls.push(ms); },
      retestDelayMs: 15000,
      now: () => 2_000_000,
    },
  );

  assert.deepEqual(sleepCalls, [15000]);
  assert.equal(result.retested, true);
  assert.equal(result.status, 'UP');
  assert.equal(result.shouldAlert, false);
});

test('availability worker alerts on sustained DOWN, respects cooldown, and alerts RECOVERED on recovery', async () => {
  const kv = makeKvStore();
  const telegramPayloads: string[] = [];
  let isDown = true;

  const fetcher = async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('api.telegram.org')) {
      const body = JSON.parse(String(init?.body || '{}'));
      telegramPayloads.push(body.text);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (target.endsWith('/health/ready') && isDown) {
      return new Response(JSON.stringify({ database: 'unhealthy' }), { status: 503 });
    }
    return healthyFetcher()(url);
  };

  const env = { MONITOR_STATE: kv, TELEGRAM_BOT_TOKEN: 'tkn', TELEGRAM_CHAT_ID: '999' };

  // T=0: sustained DOWN -> triggers DOWN alert
  const run1 = await runScheduledCheck(env, {
    fetcher,
    sleep: async () => {},
    retestDelayMs: 15000,
    cooldownMs: 30 * 60_000,
    now: () => 1_000_000,
  });
  assert.equal(run1.status, 'DOWN');
  assert.equal(run1.transition, 'DOWN');
  assert.equal(run1.shouldAlert, true);
  assert.equal(telegramPayloads.length, 1);
  assert.ok(telegramPayloads[0].includes('DOWN'));

  // T=+5m: still DOWN inside 30m cooldown -> suppressed
  const run2 = await runScheduledCheck(env, {
    fetcher,
    sleep: async () => {},
    retestDelayMs: 15000,
    cooldownMs: 30 * 60_000,
    now: () => 1_000_000 + 5 * 60_000,
  });
  assert.equal(run2.status, 'DOWN');
  assert.equal(run2.shouldAlert, false);
  assert.equal(telegramPayloads.length, 1);

  // T=+10m: recovers -> triggers RECOVERED alert
  isDown = false;
  const run3 = await runScheduledCheck(env, {
    fetcher,
    sleep: async () => {},
    retestDelayMs: 15000,
    cooldownMs: 30 * 60_000,
    now: () => 1_000_000 + 10 * 60_000,
  });
  assert.equal(run3.status, 'UP');
  assert.equal(run3.transition, 'RECOVERED');
  assert.equal(run3.shouldAlert, true);
  assert.equal(telegramPayloads.length, 2);
  assert.ok(telegramPayloads[1].includes('RECUPERADO'));
});

test('availability worker flags DEGRADED when db_pool has wait_timeouts_total > 0', async () => {
  const kv = makeKvStore();
  const result = await runScheduledCheck(
    { MONITOR_STATE: kv },
    {
      fetcher: healthyFetcher({
        '/health/ready': () => new Response(
          JSON.stringify({
            database: 'healthy',
            db_pool: { wait_timeouts_total: 2, wait_ms: { p95: 320 } },
            websocket: { transport_connected: true },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      }),
      sleep: async () => {},
      retestDelayMs: 15000,
      now: () => 3_000_000,
    },
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.shouldAlert, true);
  assert.equal(result.retested, false);

  const msg = buildTelegramMessage({
    transition: 'DEGRADED',
    probeResult: { downChecks: [], degradedChecks: [{ url: 'https://api/health/ready', reason: 'db_pool.wait_timeouts_total=2' }] },
  });
  assert.ok(msg.includes('DEGRADED'));
  assert.ok(msg.includes('db_pool.wait_timeouts_total=2'));

  const escalated = evaluateTransition({ previousState: result.state, probeStatus: 'DOWN', nowMs: 3_001_000 });
  assert.equal(escalated.shouldAlert, true);
});

test('availability worker signs and posts investigation event on DOWN transition when ingest URL is configured', async () => {
  const kv = makeKvStore();
  const ingestRequests: Array<{ headers: HeadersInit | undefined; body: any }> = [];

  const result = await runScheduledCheck(
    {
      MONITOR_STATE: kv,
      KOMA_AVAILABILITY_INGEST_URL: 'https://api.example.test/api/internal/support/availability-event',
      AVAILABILITY_WEBHOOK_SECRET: 'demo-webhook-key',
    },
    {
      fetcher: async (url: string | URL, init?: RequestInit) => {
        const target = String(url);
        if (target.includes('/api/internal/support/availability-event')) {
          ingestRequests.push({
            headers: init?.headers,
            body: JSON.parse(String(init?.body || '{}')),
          });
          return new Response(JSON.stringify({ ok: true, investigation_id: 'INV-TEST1' }), { status: 201 });
        }
        return healthyFetcher({
          '/health/live': () => new Response('down', { status: 503 }),
        })(url);
      },
      sleep: async () => {},
      retestDelayMs: 15000,
      now: () => 4_000_000,
    },
  );

  assert.equal(result.status, 'DOWN');
  assert.equal(result.investigationResult.sent, true);
  assert.equal(ingestRequests.length, 1);
  assert.equal(ingestRequests[0].body.transition, 'DOWN');
  assert.equal(ingestRequests[0].body.down_checks.length, 1);
  const sigHeader = (ingestRequests[0].headers as Record<string, string>)['X-Koma-Monitor-Signature'];
  assert.match(sigHeader, /^sha256=[a-f0-9]{64}$/);
});
