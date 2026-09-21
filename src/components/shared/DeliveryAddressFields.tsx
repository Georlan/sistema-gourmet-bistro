import type { ChangeEvent } from 'react';
import {
  type DeliveryAddressDraft,
  updateDeliveryAddressGeographicField,
} from '../../domain/deliveryAddress';

type NeighborhoodOption = {
  value: string;
  label?: string;
};

type DeliveryAddressFieldsProps = {
  value: DeliveryAddressDraft;
  onChange: (value: DeliveryAddressDraft) => void;
  neighborhoodOptions?: NeighborhoodOption[];
  compact?: boolean;
  legacyHint?: string | null;
  idPrefix?: string;
};

const updateField = (
  current: DeliveryAddressDraft,
  field: keyof DeliveryAddressDraft,
  event: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
): DeliveryAddressDraft => ({
  ...current,
  [field]: event.target.value,
});

export default function DeliveryAddressFields({
  value,
  onChange,
  neighborhoodOptions = [],
  compact = false,
  legacyHint,
  idPrefix = 'delivery-address',
}: DeliveryAddressFieldsProps) {
  const inputClass = compact
    ? 'w-full rounded-lg border border-koma-border bg-koma-input px-2 py-1.5 text-[10px] text-koma-foreground outline-none focus:border-emerald-500'
    : 'h-12 w-full rounded-xl border border-koma-border bg-koma-card px-3 text-base text-koma-foreground outline-none transition placeholder:text-koma-subtle focus:border-emerald-500';
  const labelClass = compact
    ? 'mb-1 block text-[8px] font-bold uppercase tracking-wider text-koma-subtle'
    : 'mb-1.5 block text-xs font-semibold text-koma-foreground';

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'} data-delivery-address-source="universal">
      {legacyHint && (
        <div className={compact
          ? 'rounded-lg border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[8px] leading-relaxed text-amber-300'
          : 'rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2.5 text-[10px] leading-relaxed text-amber-200'}>
          Endereço salvo anteriormente: {legacyHint}. Confirme os campos abaixo para este pedido.
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block">
          <span className={labelClass}>Bairro <span className="font-normal opacity-70">(opcional)</span></span>
          <input
            id={`${idPrefix}-bairro`}
            list={`${idPrefix}-bairro-options`}
            autoComplete="address-level3"
            placeholder={neighborhoodOptions.length > 0 ? "Digite ou selecione o bairro" : "Ex.: Centro"}
            value={value.bairro}
            onChange={(event) => onChange(updateDeliveryAddressGeographicField(value, 'bairro', event.target.value))}
            className={inputClass}
          />
          {neighborhoodOptions.length > 0 && (
            <datalist id={`${idPrefix}-bairro-options`}>
              {neighborhoodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label || option.value}
                </option>
              ))}
            </datalist>
          )}
        </label>
        {neighborhoodOptions.length > 0 && !compact && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {neighborhoodOptions.map((option) => {
              const isSelected = value.bairro.trim().toLowerCase() === option.value.trim().toLowerCase();
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange(updateDeliveryAddressGeographicField(value, 'bairro', option.value))}
                  className={`inline-flex items-center rounded-lg border px-2 py-1 text-[10px] font-medium transition ${
                    isSelected
                      ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-400 font-bold'
                      : 'border-koma-border bg-koma-panel text-koma-muted hover:border-emerald-500/30 hover:text-koma-foreground'
                  }`}
                >
                  {option.label || option.value}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_92px] gap-2">
        <label>
          <span className={labelClass}>Logradouro</span>
          <input
            id={`${idPrefix}-logradouro`}
            autoComplete="address-line1"
            placeholder="Rua, avenida..."
            value={value.logradouro}
            onChange={(event) => onChange(updateDeliveryAddressGeographicField(value, 'logradouro', event.target.value))}
            className={inputClass}
            required
          />
        </label>
        <label>
          <span className={labelClass}>Número</span>
          <input
            id={`${idPrefix}-numero`}
            autoComplete="address-line2"
            placeholder="123"
            value={value.numero}
            onChange={(event) => onChange(updateDeliveryAddressGeographicField(value, 'numero', event.target.value))}
            className={inputClass}
            required
          />
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Complemento <span className="font-normal opacity-70">(opcional)</span></span>
        <input
          id={`${idPrefix}-complemento`}
          placeholder="Apto, bloco, sala..."
          value={value.complemento}
          onChange={(event) => onChange(updateField(value, 'complemento', event))}
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Referência <span className="font-normal opacity-70">(opcional)</span></span>
        <input
          id={`${idPrefix}-referencia`}
          placeholder="Ex.: portaria lateral"
          value={value.referencia}
          onChange={(event) => onChange(updateField(value, 'referencia', event))}
          className={inputClass}
        />
      </label>
    </div>
  );
}
