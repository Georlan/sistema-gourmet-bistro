import { useEffect, useRef, useState } from 'react';
import type { DeliveryAddressDraft } from '../../domain/deliveryAddress';
import {
  defaultPostalCodeLookupProvider,
  normalizePostalCode,
  type PostalCodeLookupProvider,
} from '../../integrations/postalCode/postalCodeLookup';

type Props = {
  value: DeliveryAddressDraft;
  onChange: (value: DeliveryAddressDraft) => void;
  compact?: boolean;
  provider?: PostalCodeLookupProvider;
};

export default function PostalCodeLookupStatus({
  value,
  onChange,
  compact = false,
  provider = defaultPostalCodeLookupProvider,
}: Props) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'found' | 'unavailable'>('idle');
  const requestSequence = useRef(0);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  const postalCode = normalizePostalCode(value.cep);
  useEffect(() => {
    const sequence = ++requestSequence.current;
    if (postalCode.length !== 8) {
      setStatus('idle');
      return undefined;
    }

    const controller = new AbortController();
    setStatus('loading');
    const timer = window.setTimeout(async () => {
      try {
        const address = await provider.lookup(postalCode, controller.signal);
        if (sequence !== requestSequence.current || controller.signal.aborted) return;
        if (!address) {
          setStatus('unavailable');
          return;
        }
        const current = valueRef.current;
        if (normalizePostalCode(current.cep) !== postalCode) return;
        onChangeRef.current({
          ...current,
          logradouro: address.street || current.logradouro,
          bairro: address.neighborhood || current.bairro,
          cidade: address.city || current.cidade,
          uf: address.state || current.uf,
          cep: address.postalCode,
          latitude: null,
          longitude: null,
        });
        setStatus('found');
      } catch {
        if (sequence === requestSequence.current && !controller.signal.aborted) {
          setStatus('unavailable');
        }
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [postalCode, provider]);

  const text = status === 'loading'
    ? 'Consultando CEP…'
    : status === 'found'
      ? 'Endereço sugerido pelo CEP. Confira e ajuste os campos.'
      : status === 'unavailable'
        ? 'Não foi possível consultar este CEP. Continue preenchendo manualmente.'
        : 'O CEP ajuda a preencher o endereço, mas todos os campos podem ser editados.';

  return (
    <p
      aria-live="polite"
      data-postal-code-status={status}
      className={`${compact ? 'mt-1 text-[8px]' : 'mt-1.5 text-[10px]'} text-koma-subtle`}
    >
      {text}
    </p>
  );
}
