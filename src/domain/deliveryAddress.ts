export interface DeliveryAddressSnapshot {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  referencia?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface DeliveryAddressDraft {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  referencia: string;
  latitude?: number | null;
  longitude?: number | null;
}

export const EMPTY_DELIVERY_ADDRESS: DeliveryAddressDraft = {
  logradouro: '',
  numero: '',
  complemento: '',
  bairro: '',
  cidade: '',
  uf: '',
  cep: '',
  referencia: '',
  latitude: null,
  longitude: null,
};

const compactWhitespace = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');
const cepDigits = (value: unknown) => String(value ?? '').replace(/\D/g, '').slice(0, 8);
const normalizedCoordinate = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
};

export type DeliveryAddressGeographicField =
  | 'logradouro'
  | 'numero'
  | 'bairro'
  | 'cidade'
  | 'uf'
  | 'cep';

export const updateDeliveryAddressGeographicField = (
  draft: DeliveryAddressDraft,
  field: DeliveryAddressGeographicField,
  value: string,
): DeliveryAddressDraft => ({
  ...draft,
  [field]: value,
  latitude: null,
  longitude: null,
});

export const normalizeDeliveryAddressDraft = (draft: DeliveryAddressDraft): DeliveryAddressDraft => ({
  logradouro: compactWhitespace(draft.logradouro),
  numero: compactWhitespace(draft.numero),
  complemento: compactWhitespace(draft.complemento),
  bairro: compactWhitespace(draft.bairro),
  cidade: compactWhitespace(draft.cidade),
  uf: compactWhitespace(draft.uf).replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase(),
  cep: cepDigits(draft.cep),
  referencia: compactWhitespace(draft.referencia),
  latitude: normalizedCoordinate(draft.latitude),
  longitude: normalizedCoordinate(draft.longitude),
});

export const getDeliveryAddressValidationError = (draft: DeliveryAddressDraft): string | null => {
  const value = normalizeDeliveryAddressDraft(draft);
  if (!value.logradouro) return 'Informe o logradouro.';
  if (!value.numero) return 'Informe o número.';
  if (value.uf && value.uf.length !== 2) return 'Informe a UF com 2 letras.';
  if (value.cep && value.cep.length !== 8) return 'Informe um CEP com 8 dígitos ou deixe o campo vazio.';
  if ((value.latitude === null) !== (value.longitude === null)) {
    return 'Latitude e longitude devem ser informadas juntas.';
  }
  if (value.latitude !== null && (value.latitude < -90 || value.latitude > 90)) {
    return 'Latitude inválida.';
  }
  if (value.longitude !== null && (value.longitude < -180 || value.longitude > 180)) {
    return 'Longitude inválida.';
  }
  if (value.latitude === 0 && value.longitude === 0) {
    return 'As coordenadas não podem ser 0,0.';
  }
  return null;
};

export const deliveryAddressDraftToSnapshot = (
  draft: DeliveryAddressDraft,
): DeliveryAddressSnapshot | null => {
  if (getDeliveryAddressValidationError(draft)) return null;
  const value = normalizeDeliveryAddressDraft(draft);
  return {
    logradouro: value.logradouro,
    numero: value.numero,
    complemento: value.complemento || null,
    bairro: value.bairro,
    cidade: value.cidade,
    uf: value.uf,
    cep: value.cep,
    referencia: value.referencia || null,
    latitude: value.latitude,
    longitude: value.longitude,
  };
};

export const formatDeliveryAddressLegacy = (snapshot: DeliveryAddressSnapshot): string => {
  const postalCode = cepDigits(snapshot.cep);
  const formattedCep = postalCode.length === 8
    ? `${postalCode.slice(0, 5)}-${postalCode.slice(5)}`
    : postalCode;
  const cityState = [
    compactWhitespace(snapshot.cidade),
    compactWhitespace(snapshot.uf).toUpperCase(),
  ].filter(Boolean).join(' - ');
  const parts = [
    compactWhitespace(snapshot.logradouro),
    compactWhitespace(snapshot.numero),
    compactWhitespace(snapshot.complemento),
    compactWhitespace(snapshot.bairro),
    cityState,
    formattedCep ? `CEP ${formattedCep}` : '',
  ].filter(Boolean);
  const reference = compactWhitespace(snapshot.referencia);
  if (reference) parts.push(`Ref.: ${reference}`);
  return parts.join(', ');
};

export const formatDeliveryAddressDraftLegacy = (draft: DeliveryAddressDraft): string => {
  const snapshot = deliveryAddressDraftToSnapshot(draft);
  return snapshot ? formatDeliveryAddressLegacy(snapshot) : '';
};

/**
 * Reconhece tanto o formato canônico completo quanto o simplificado por bairros.
 * Endereços livres não padronizados permanecem como dica visual.
 */
export const parseDeliveryAddressLegacy = (value: unknown): DeliveryAddressDraft | null => {
  let raw = compactWhitespace(value);
  if (!raw) return null;

  let referencia = '';
  const referenceMarker = ', Ref.: ';
  const referenceIndex = raw.lastIndexOf(referenceMarker);
  if (referenceIndex >= 0) {
    referencia = raw.slice(referenceIndex + referenceMarker.length).trim();
    raw = raw.slice(0, referenceIndex).trim();
  }

  let cep = '';
  const cepMatch = raw.match(/^(.*), CEP\s+(\d{5})-?(\d{3})$/i);
  if (cepMatch) {
    cep = `${cepMatch[2]}${cepMatch[3]}`;
    raw = cepMatch[1].trim();
  }

  let cidade = '';
  let uf = '';
  const cityMatch = raw.match(/^(.*),\s*([^,]+?)\s*-\s*([A-Za-z]{2})$/);
  if (cityMatch) {
    raw = cityMatch[1].trim();
    cidade = cityMatch[2].trim();
    uf = cityMatch[3].toUpperCase();
  }

  const segments = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (segments.length < 3) return null;

  const logradouro = segments[0];
  const numero = segments[1];
  if (!cityMatch && !/\d|^s\/n$/i.test(numero)) return null;

  const bairro = segments[segments.length - 1];
  const complemento = segments.length > 3 ? segments.slice(2, -1).join(', ') : '';

  const draft = normalizeDeliveryAddressDraft({
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    cep,
    referencia,
    latitude: null,
    longitude: null,
  });
  return getDeliveryAddressValidationError(draft) ? null : draft;
};

export const formatCepInput = (value: string): string => {
  const digits = cepDigits(value);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
};
