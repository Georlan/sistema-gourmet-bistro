const HEX = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, '0'));

function uuidFromRandomValues(cryptoApi: Crypto): string {
  if (typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Secure random generator unavailable.');
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  // RFC 4122 v4 bits. Entropy still comes exclusively from CSPRNG.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => HEX[value]).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createSecureIdempotencyKey(prefix = 'idem'): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) {
    throw new Error('Secure random generator unavailable; refusing to create an idempotency key.');
  }

  const id = typeof cryptoApi.randomUUID === 'function'
    ? cryptoApi.randomUUID()
    : uuidFromRandomValues(cryptoApi);
  return `${prefix}-${id}`;
}
