const SESSION_KEY = 'koma_pagbank_oauth_state';
const PREFIX = 'koma_pagbank_oauth_pending:';
const TTL_MS = 10 * 60_000;

// A bank may return in a different tab. Share only the random state, never
// authorization codes or tokens. The server still verifies tenant/admin/MAC.
export function rememberPagBankState(state: string): void {
  let stored = false;
  try { sessionStorage.setItem(SESSION_KEY, state); stored = true; } catch { /* Try shared storage. */ }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const age = Date.now() - Number(localStorage.getItem(key));
      if (!Number.isFinite(age) || age < 0 || age > TTL_MS) localStorage.removeItem(key);
    }
    localStorage.setItem(PREFIX + state, String(Date.now())); stored = true;
  } catch { /* Same-tab fallback. */ }
  if (!stored) throw new Error('Permita o armazenamento neste navegador para conectar o PagBank.');
}

export function matchesPagBankState(state: string): boolean {
  if (!state) return false;
  try {
    const issued = localStorage.getItem(PREFIX + state);
    if (issued !== null) {
      const age = Date.now() - Number(issued);
      if (Number.isFinite(age) && age >= 0 && age <= TTL_MS) return true;
      forgetPagBankState(state);
      return false;
    }
  } catch { /* Legacy same-tab binding is still supported. */ }
  try { return sessionStorage.getItem(SESSION_KEY) === state; } catch { return false; }
}

export function forgetPagBankState(state?: string): void {
  try {
    const current = sessionStorage.getItem(SESSION_KEY);
    if (!state || current === state) sessionStorage.removeItem(SESSION_KEY);
    if (!state) state = current || undefined;
  } catch { /* Storage may be disabled. */ }
  if (state) {
    try { localStorage.removeItem(PREFIX + state); } catch { /* Best effort cleanup. */ }
  }
}
