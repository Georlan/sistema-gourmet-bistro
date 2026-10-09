import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeHttp } from '../scripts/http-observability.mjs';

test('authentication storms and long streams cannot mask checkout latency', () => {
  const sample = [
    ...Array.from({ length: 100 }, () => ({ path: '/api/print-agents/heartbeat', status_code: 401, duration_ms: 1 })),
    { path: '/api/print-agents/events', status_code: 200, duration_ms: 60000 },
    { path: '/api/cardapio/pedidos/acompanhar/secret-token/events', status_code: 200, duration_ms: 30000 },
    { path: '/ws', status_code: 101, duration_ms: 30000 },
    { path: '/cardapio/pedidos', status_code: 200, duration_ms: 100 },
    { path: '/cardapio/pedidos', status_code: 201, duration_ms: 300 },
    { path: '/cardapio/pedidos', status_code: 503, duration_ms: 5000 },
    { path: '/comandas/{id}/transferir/{mesa}', status_code: 409, duration_ms: 40 },
  ];
  const result = summarizeHttp(sample);
  assert.equal(result.checkout.successful_http_p50_ms, 100);
  assert.equal(result.checkout.successful_http_p95_ms, 300);
  assert.equal(result.checkout.server_errors, 1);
  assert.equal(result.printing.statuses.authentication, 100);
  assert.equal(result.sse.latency_samples, 0);
  assert.equal(result.websocket.latency_samples, 0);
  assert.equal(result.orders.statuses.conflict, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('absent latency remains unknown and invalid samples are excluded', () => {
  const result = summarizeHttp([
    { path: '/api/print-agents/claim-batch', httpStatus: 200 },
    { path: '/api/print-agents/claim-batch', httpStatus: 200, totalDuration: -1 },
    { path: '/api/print-agents/claim-batch', httpStatus: 429, totalDuration: 1 },
  ]);
  assert.equal(result.printing.successful_http_p95_ms, null);
  assert.equal(result.printing.statuses.rate_limited, 1);
});
