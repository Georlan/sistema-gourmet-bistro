import type { DeliveryAddressDraft } from '../../domain/deliveryAddress';

type AddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type GoogleLocation = {
  lat: () => number;
  lng: () => number;
};

export type GooglePlacePrediction = {
  placePrediction?: {
    text?: { toString: () => string };
    toPlace: () => {
      addressComponents?: AddressComponent[];
      formattedAddress?: string;
      location?: GoogleLocation;
      fetchFields: (request: { fields: string[] }) => Promise<void>;
    };
  };
};

type PlacesLibrary = {
  AutocompleteSessionToken: new () => object;
  AutocompleteSuggestion: {
    fetchAutocompleteSuggestions: (request: Record<string, unknown>) => Promise<{
      suggestions?: GooglePlacePrediction[];
    }>;
  };
};

declare global {
  interface Window {
    google?: {
      maps?: {
        importLibrary?: (name: string) => Promise<unknown>;
      };
    };
    __komaGoogleMapsReady?: () => void;
  }
}

let loaderPromise: Promise<PlacesLibrary> | null = null;

export const getGoogleMapsBrowserKey = (): string => (
  (import.meta as { env?: { VITE_GOOGLE_MAPS_BROWSER_KEY?: string } }).env
    ?.VITE_GOOGLE_MAPS_BROWSER_KEY || ''
).trim();

export const loadGooglePlacesLibrary = (): Promise<PlacesLibrary> => {
  if (loaderPromise) return loaderPromise;

  const apiKey = getGoogleMapsBrowserKey();
  if (!apiKey) return Promise.reject(new Error('Google Places não configurado.'));

  loaderPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-koma-google-maps]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar Google Maps.')), { once: true });
      return;
    }

    window.__komaGoogleMapsReady = () => resolve();
    const script = document.createElement('script');
    script.dataset.komaGoogleMaps = 'true';
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&libraries=places&v=weekly&callback=__komaGoogleMapsReady`;
    script.onerror = () => reject(new Error('Falha ao carregar Google Maps.'));
    document.head.appendChild(script);
  }).then(async () => {
    const importLibrary = window.google?.maps?.importLibrary;
    if (!importLibrary) throw new Error('Biblioteca Google Places indisponível.');
    return importLibrary('places') as Promise<PlacesLibrary>;
  }).catch((error) => {
    loaderPromise = null;
    throw error;
  });

  return loaderPromise;
};

const componentValue = (
  components: AddressComponent[],
  types: string[],
  short = false,
): string => {
  const component = components.find((candidate) => candidate.types?.some((type) => types.includes(type)));
  return (short ? component?.shortText : component?.longText)?.trim() || '';
};

export const placePredictionToAddressDraft = async (
  suggestion: GooglePlacePrediction,
  current: DeliveryAddressDraft,
): Promise<DeliveryAddressDraft> => {
  const place = suggestion.placePrediction?.toPlace();
  if (!place) throw new Error('Sugestão de endereço inválida.');

  await place.fetchFields({ fields: ['addressComponents', 'formattedAddress', 'location'] });
  const components = place.addressComponents || [];
  const latitude = place.location?.lat();
  const longitude = place.location?.lng();

  return {
    ...current,
    logradouro: componentValue(components, ['route']),
    numero: componentValue(components, ['street_number']),
    bairro: componentValue(components, ['sublocality_level_1', 'sublocality', 'neighborhood']),
    cidade: componentValue(components, ['administrative_area_level_2', 'locality']),
    uf: componentValue(components, ['administrative_area_level_1'], true).toUpperCase(),
    cep: componentValue(components, ['postal_code']).replace(/\D/g, '').slice(0, 8),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
};
