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

test('browser network failure does not leak the raw Failed to fetch message', () => {
  const message = authRequestErrorMessage(new TypeError('Failed to fetch'), 'fallback');
  assert.match(message, /servidor do KÔMA está indisponível/i);
  assert.doesNotMatch(message, /failed to fetch/i);
});

test('JSON deadline also aborts a stalled body after successful HTTP headers', async () => {
  const {authFetchJson}=await import('../src/utils/authRequest');
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=(async(_input,init)=>({status:200,ok:true,json:()=>new Promise((_resolve,reject)=>{
      init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
    })})) as typeof fetch;
    await assert.rejects(authFetchJson('https://example.test/auth/login',{},5),error=>error instanceof AuthRequestTimeoutError);
  } finally {globalThis.fetch=originalFetch;}
});

test('JSON decoder preserves non-JSON error status for an accessible fallback',async()=>{
  const {authFetchJson}=await import('../src/utils/authRequest');
  const originalFetch=globalThis.fetch;
  try {
    globalThis.fetch=(async()=>new Response('Bad Gateway',{status:502})) as typeof fetch;
    const {response,data}=await authFetchJson('https://example.test/auth/login');
    assert.equal(response.status,502);assert.equal(data,null);
  } finally {globalThis.fetch=originalFetch;}
});
