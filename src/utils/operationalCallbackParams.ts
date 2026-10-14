/**
 * Keep only explicitly supported one-time callbacks while removing legacy
 * operational query parameters on the canonical app.komafood.com.br host.
 *
 * The PagBank callback is returned through ?pagbank=authorized&code=...&state=...
 * and must survive the entry-point normalization until PagBankConnectionCard
 * validates the browser-bound state, calls /payments/pagbank/complete and
 * immediately removes the one-time parameters with history.replaceState.
 */
export function canonicalOperationalQuery(search: string): string {
  const incoming = new URLSearchParams(search);
  const canonical = new URLSearchParams();

  const pairingNonce = incoming.get('pair_print_agent')?.trim() || '';
  const pairingPort = Number(incoming.get('agent_port')?.trim() || '');
  if (pairingNonce && Number.isInteger(pairingPort) && pairingPort >= 17654 && pairingPort <= 17664) {
    canonical.set('pair_print_agent', pairingNonce);
    canonical.set('agent_port', String(pairingPort));
  }

  const result = incoming.get('pagbank');
  const state = incoming.get('state') || '';
  if (state && state.length <= 128) {
    if (result === 'authorized') {
      const code = incoming.get('code') || '';
      if (code && code.length <= 512) {
        canonical.set('pagbank', 'authorized');
        canonical.set('code', code);
        canonical.set('state', state);
      }
    } else if (result === 'cancelled') {
      canonical.set('pagbank', 'cancelled');
      canonical.set('state', state);
    }
  }

  return canonical.toString();
}
