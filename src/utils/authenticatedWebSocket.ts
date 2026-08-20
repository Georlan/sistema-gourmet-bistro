const KOMA_AUTH_SUBPROTOCOL = 'koma-auth';

/**
 * Envia o JWT no cabeçalho de negociação do WebSocket. Tokens na query string
 * aparecem nos access logs do proxy/servidor e podem ser reutilizados por quem
 * tiver acesso aos registros.
 */
export function openAuthenticatedWebSocket(url: string, token: string) {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('Token ausente para conexão em tempo real.');

  const sanitizedUrl = new URL(url, window.location.href);
  sanitizedUrl.searchParams.delete('token');
  return new WebSocket(sanitizedUrl.toString(), [KOMA_AUTH_SUBPROTOCOL, normalizedToken]);
}
