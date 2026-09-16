import { useEffect, useRef, useState } from 'react';
import type { DeliveryAddressDraft } from '../../domain/deliveryAddress';
import {
  getGoogleMapsBrowserKey,
  loadGooglePlacesLibrary,
  placePredictionToAddressDraft,
  type GooglePlacePrediction,
} from '../../integrations/googleMaps/placesAddress';

type Props = {
  value: DeliveryAddressDraft;
  onChange: (value: DeliveryAddressDraft) => void;
  compact?: boolean;
  idPrefix: string;
};

export default function GooglePlacesAddressAutocomplete({ value, onChange, compact, idPrefix }: Props) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GooglePlacePrediction[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const sessionToken = useRef<object | null>(null);
  const requestSequence = useRef(0);
  const selectionSequence = useRef(0);

  const enabled = Boolean(getGoogleMapsBrowserKey());

  useEffect(() => {
    const sequence = ++requestSequence.current;
    if (!enabled || query.trim().length < 3) {
      setSuggestions([]);
      return undefined;
    }

    const timer = window.setTimeout(async () => {
      try {
        const library = await loadGooglePlacesLibrary();
        sessionToken.current ||= new library.AutocompleteSessionToken();
        const response = await library.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query.trim(),
          includedRegionCodes: ['br'],
          language: 'pt-BR',
          region: 'br',
          sessionToken: sessionToken.current,
        });
        if (sequence === requestSequence.current) {
          setSuggestions((response.suggestions || []).filter((item) => item.placePrediction));
          setUnavailable(false);
        }
      } catch {
        if (sequence === requestSequence.current) {
          setSuggestions([]);
          setUnavailable(true);
        }
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [enabled, query]);

  if (!enabled) return null;

  const inputClass = compact
    ? 'w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground outline-none focus:border-emerald-500'
    : 'h-12 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-base text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500';
  const labelClass = compact
    ? 'mb-1 block text-[8px] font-bold uppercase tracking-wider text-koma-subtle'
    : 'mb-1.5 block text-xs font-semibold text-koma-foreground';

  const selectSuggestion = async (suggestion: GooglePlacePrediction) => {
    const sequence = ++selectionSequence.current;
    try {
      const nextAddress = await placePredictionToAddressDraft(suggestion, value);
      if (sequence !== selectionSequence.current) return;
      onChange(nextAddress);
      setQuery('');
      setSuggestions([]);
      sessionToken.current = null;
      setUnavailable(false);
    } catch {
      if (sequence === selectionSequence.current) setUnavailable(true);
    }
  };

  return (
    <div className="relative" data-google-places-autocomplete="optional">
      <label className="block" htmlFor={`${idPrefix}-google-search`}>
        <span className={labelClass}>Buscar endereço</span>
        <input
          id={`${idPrefix}-google-search`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className={inputClass}
          placeholder="Digite rua, número e cidade"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={`${idPrefix}-google-suggestions`}
          aria-expanded={suggestions.length > 0}
        />
      </label>
      {suggestions.length > 0 && (
        <ul
          id={`${idPrefix}-google-suggestions`}
          className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-koma-border bg-koma-card p-1 shadow-xl"
          role="listbox"
        >
          {suggestions.map((suggestion, index) => {
            const label = suggestion.placePrediction?.text?.toString() || 'Endereço sugerido';
            return (
              <li key={`${label}-${index}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-koma-foreground hover:bg-koma-hover focus:bg-koma-hover focus:outline-none"
                  onClick={() => void selectSuggestion(suggestion)}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={`${compact ? 'mt-1 text-[8px]' : 'mt-1.5 text-[10px]'} text-koma-subtle`}>
        {unavailable
          ? 'Busca indisponível agora. Preencha o endereço manualmente abaixo.'
          : 'Selecione uma sugestão ou preencha manualmente.'}
      </p>
    </div>
  );
}
