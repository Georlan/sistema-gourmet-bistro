// Capture and remove the capability before analytics/monitoring initialize.
// Never persist it in localStorage, query strings or logs.
let token = '';
if (typeof window !== 'undefined' && window.location.pathname === '/whatsapp/avisos') {
  token = new URLSearchParams(window.location.hash.slice(1)).get('token') || '';
  window.history.replaceState(window.history.state, '', window.location.pathname);
}
export function whatsappOptOutToken(): string { return token; }
