export type PostalCodeAddress = {
  postalCode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
};

export interface PostalCodeLookupProvider {
  readonly id: string;
  lookup(postalCode: string, signal?: AbortSignal): Promise<PostalCodeAddress | null>;
}

export const normalizePostalCode = (value: unknown): string =>
  String(value ?? '').replace(/\D/g, '').slice(0, 8);

type ViaCepResponse = {
  cep?: unknown;
  logradouro?: unknown;
  bairro?: unknown;
  localidade?: unknown;
  uf?: unknown;
  erro?: unknown;
};

const compact = (value: unknown): string => String(value ?? '').trim().replace(/\s+/g, ' ');

export class ViaCepPostalCodeLookupProvider implements PostalCodeLookupProvider {
  readonly id = 'viacep';

  constructor(
    private readonly request: typeof fetch = (input, init) => fetch(input, init),
    private readonly timeoutMs = 4_000,
  ) {}

  async lookup(postalCode: string, signal?: AbortSignal): Promise<PostalCodeAddress | null> {
    const expected = normalizePostalCode(postalCode);
    if (expected.length !== 8) return null;

    const requestController = new AbortController();
    const abortFromCaller = () => requestController.abort(signal?.reason);
    if (signal?.aborted) abortFromCaller();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => requestController.abort(), this.timeoutMs);
    try {
      const response = await this.request(`https://viacep.com.br/ws/${expected}/json/`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: requestController.signal,
      });
      if (!response.ok) return null;

      const payload = await response.json().catch(() => null) as ViaCepResponse | null;
      if (!payload || typeof payload !== 'object' || payload.erro === true) return null;
      const returned = normalizePostalCode(payload.cep);
      if (returned !== expected) return null;

      const city = compact(payload.localidade);
      const state = compact(payload.uf).replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
      if (!city || state.length !== 2) return null;

      return {
        postalCode: expected,
        street: compact(payload.logradouro),
        neighborhood: compact(payload.bairro),
        city,
        state,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

export const defaultPostalCodeLookupProvider: PostalCodeLookupProvider =
  new ViaCepPostalCodeLookupProvider();
