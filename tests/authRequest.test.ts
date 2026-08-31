import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AuthRequestTimeoutError,
  authFetch,
  authRequestErrorMessage,
} from '../src/utils/authRequest';

test('authFetch preserves a successful response', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (_input, init) => {
      assert.ok(init?.signal);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    const response = await authFetch('https://example.test/auth/login', { method: 'POST' }, 50);
    assert.equal(response.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authFetch aborts a hung authentication request at the deadline', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })) as typeof fetch;

    await assert.rejects(
      authFetch('https://example.test/auth/login', { method: 'POST' }, 5),
      (error: unknown) => error instanceof AuthRequestTimeoutError && error.timeoutMs === 5,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('authFetch preserves an upstream abort instead of reporting a timeout', async () => {
  const originalFetch = globalThis.fetch;
  const upstream = new AbortController();
  try {
    globalThis.fetch = ((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('cancelled upstream');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })) as typeof fetch;

    const promise = authFetch('https://example.test/auth/login', { signal: upstream.signal }, 100);
    upstream.abort();
    await assert.rejects(promise, (error: unknown) => (
      error instanceof Error
      && error.name === 'AbortError'
      && !(error instanceof AuthRequestTimeoutError)
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('timeout has a user-facing recovery message', () => {
  assert.match(
    authRequestErrorMessage(new AuthRequestTimeoutError(12000), 'fallback'),
    /demorou para responder/i,
  );
});
