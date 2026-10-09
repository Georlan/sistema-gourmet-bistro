// Summaries contain categories only, never raw URLs, client IPs or credentials.
export function requestCategory(entry) {
  const path = String(entry.path || '').split(/[?#]/)[0];
  const status = Number(entry.status_code ?? entry.httpStatus);
  if (status === 101 || /^\/ws(?:\/|$)/.test(path)) return 'websocket';
  if (path === '/api/print-agents/events' || path === '/api/caixa/conversas/events'
      || /^\/api\/cardapio\/pedidos\/acompanhar\/[^/]+\/events$/.test(path)) return 'sse';
  if (path.startsWith('/api/print-agents/')) return 'printing';
  if (/\/(?:pagamentos|payments|pix)(?:\/|$)/.test(path)) return 'payments';
  if (/\/(?:api\/)?cardapio\/pedidos(?:\/|$)/.test(path)) return 'checkout';
  if (/\/(?:pedidos|comandas|atendimentos)(?:\/|$)/.test(path)) return 'orders';
  return 'other_http';
}

function statusCategory(status) {
  if (status >= 500 && status <= 599) return 'server_error';
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status <= 499) return 'other_client_error';
  if (status >= 200 && status <= 399) return 'success';
  return 'incomplete_or_other';
}

function percentile(values, fraction) {
  if (!values.length) return null;
  return values[Math.max(0, Math.ceil(values.length * fraction) - 1)];
}

export function summarizeHttp(entries) {
  const groups = {};
  for (const entry of entries) {
    const category = requestCategory(entry);
    const group = groups[category] ||= { requests: 0, statuses: {}, successfulDurations: [] };
    const status = Number(entry.status_code ?? entry.httpStatus);
    const statusClass = statusCategory(status);
    group.requests += 1;
    group.statuses[statusClass] = (group.statuses[statusClass] || 0) + 1;
    const duration = entry.duration_ms;
    if (statusClass === 'success' && !['sse', 'websocket'].includes(category)
        && typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
      group.successfulDurations.push(duration);
    }
  }
  return Object.fromEntries(Object.entries(groups).map(([category, group]) => {
    const values = group.successfulDurations.sort((a, b) => a - b);
    return [category, {
      requests: group.requests,
      statuses: group.statuses,
      server_errors: group.statuses.server_error || 0,
      // Error/auth durations and persistent streams never distort healthy HTTP.
      latency_samples: values.length,
      successful_http_p50_ms: percentile(values, .5),
      successful_http_p95_ms: percentile(values, .95),
    }];
  }));
}
