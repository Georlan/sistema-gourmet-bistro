type RegistrationLocation = Pick<Location, 'pathname' | 'hash'>;
type RegistrationHistory = Pick<History, 'replaceState'>;

export function consumeCustomerRegistrationTokenFromLocation(
  location: RegistrationLocation,
  history: RegistrationHistory,
): string {
  if (location.pathname !== '/confirmar-cadastro' || !location.hash) return '';

  const token = new URLSearchParams(location.hash.slice(1)).get('token')?.trim() || '';
  history.replaceState(null, '', location.pathname);
  return token;
}

// Imported by main.tsx before monitoring so the confirmation secret is removed
// from the address bar before third-party instrumentation can observe it.
let bootstrapToken = typeof window === 'undefined'
  ? ''
  : consumeCustomerRegistrationTokenFromLocation(window.location, window.history);

export function takeCustomerRegistrationToken(): string {
  if (bootstrapToken) {
    const token = bootstrapToken;
    bootstrapToken = '';
    return token;
  }
  if (typeof window === 'undefined') return '';
  return consumeCustomerRegistrationTokenFromLocation(window.location, window.history);
}
