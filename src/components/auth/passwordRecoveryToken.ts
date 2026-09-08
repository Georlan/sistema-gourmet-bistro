// Read once before monitoring starts; a reset secret must never remain in the URL.
export const recoveryToken = window.location.pathname === '/recuperar-senha'
  ? new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  : '';
if (window.location.pathname === '/recuperar-senha' && window.location.hash) {
  window.history.replaceState(null, '', window.location.pathname);
}
