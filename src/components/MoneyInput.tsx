import React from 'react';

interface MoneyInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode'
> {
  value: number | '';
  onValueChange: (value: number | '') => void;
  selectOnFocus?: boolean;
}

const moneyInputFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/**
 * Campo monetário no padrão de PDV brasileiro.
 *
 * A digitação trabalha sempre em centavos:
 * 1 -> 0,01 | 12 -> 0,12 | 123 -> 1,23 | 1234 -> 12,34.
 * O componente entrega ao domínio apenas o valor numérico já convertido;
 * validação financeira e arredondamento continuam responsabilidade do backend.
 */
export const MoneyInput: React.FC<MoneyInputProps> = ({
  value,
  onValueChange,
  selectOnFocus = false,
  onFocus,
  ...props
}) => {
  const displayValue = value === ''
    ? ''
    : moneyInputFormatter.format(Number(value) || 0);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const digits = event.target.value.replace(/\D/g, '');
    if (!digits) {
      onValueChange('');
      return;
    }

    const cents = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(cents)) return;

    onValueChange(cents / 100);
  };

  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    if (selectOnFocus) event.currentTarget.select();
    onFocus?.(event);
  };

  return (
    <input
      {...props}
      type="text"
      inputMode="numeric"
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
    />
  );
};

export default MoneyInput;
