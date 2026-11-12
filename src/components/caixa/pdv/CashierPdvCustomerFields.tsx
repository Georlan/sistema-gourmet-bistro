import type { ChangeEvent } from 'react';

interface Props {
  name: string;
  phone: string;
  required: boolean;
  lookupStatus: 'idle' | 'loading' | 'found' | 'new' | 'error';
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
}

/** One customer form for pickup and delivery; neither variant owns CRM state. */
export function CashierPdvCustomerFields({
  name, phone, required, lookupStatus, onNameChange, onPhoneChange,
}: Props) {
  const phoneChanged = (event: ChangeEvent<HTMLInputElement>) => onPhoneChange(event.target.value);
  return (
    <div className="cashier-pdv-customer-fields">
      <div>
        <label htmlFor="pdv-customer-phone-input">Telefone{required && <span aria-hidden="true"> *</span>}</label>
        <input
          id="pdv-customer-phone-input"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="(00) 00000-0000"
          required={required}
          aria-required={required}
          value={phone}
          onChange={phoneChanged}
        />
      </div>
      <div>
        <label htmlFor="pdv-customer-name-input">Nome{required && <span aria-hidden="true"> *</span>}</label>
        <input
          id="pdv-customer-name-input"
          type="text"
          autoComplete="name"
          placeholder="Ex.: Maria"
          required={required}
          aria-required={required}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>
      {lookupStatus !== 'idle' && (
        <p className="cashier-pdv-customer-fields__lookup" role="status" aria-live="polite">
          {lookupStatus === 'loading' && 'Buscando cliente...'}
          {lookupStatus === 'found' && 'Cliente encontrado.'}
          {lookupStatus === 'new' && 'Novo número — o cliente será criado ao lançar o pedido.'}
          {lookupStatus === 'error' && 'Não foi possível consultar o cliente. Confira os dados.'}
        </p>
      )}
    </div>
  );
}
