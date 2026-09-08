type RecoveryLocation = Pick<Location, 'pathname' | 'hash'>;
type RecoveryHistory = Pick<History, 'replaceState'>;

export function consumeRecoveryTokenFromLocation(
  location: RecoveryLocation,
  history: RecoveryHistory,
): string {
  if (location.pathname !== '/recuperar-senha' || !location.hash) return '';

  const token = new URLSearchParams(location.hash.slice(1)).get('token')?.trim() || '';
  // Clear the fragment immediately, even when malformed, so reset secrets never linger in the URL.
  history.replaceState(null, '', location.pathname);
  return token;
}

// Cold-load bootstrap: main.tsx imports this module before monitoring starts, so a reset
// secret is removed before third-party instrumentation can observe the location.
let bootstrapToken = typeof window === 'undefined'
  ? ''
  : consumeRecoveryTokenFromLocation(window.location, window.history);

export function takeRecoveryToken(): string {
  if (bootstrapToken) {
    const token = bootstrapToken;
    bootstrapToken = '';
    return token;
  }
  if (typeof window === 'undefined') return '';
  return consumeRecoveryTokenFromLocation(window.location, window.history);
}
