// Capture and remove the capability before analytics/monitoring initialize.
// Never persist it in localStorage, query strings or logs.
let token = '';
if (typeof window !== 'undefined' && ['/whatsapp/avisos', '/w/a', '/w/c'].includes(window.location.pathname)) {
  const fragment = window.location.hash.slice(1);
  token = fragment.startsWith('token=') ? new URLSearchParams(fragment).get('token') || '' : fragment;
  window.history.replaceState(window.history.state, '', window.location.pathname);
}
export function whatsappOptOutToken(): string { return token; }

export function whatsappConsentToken(): string { return token; }
