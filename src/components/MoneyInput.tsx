import React from 'react';

interface MoneyInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'inputMode'
> {
  value: number | '';
  onValueChange: (value: number | '') => void;
  selectOnFocus?: boolean;
  fractionDigits?: number;
  allowNegative?: boolean;
}

const formatterCache = new Map<number, Intl.NumberFormat>();

const formatterFor = (fractionDigits: number) => {
  const cached = formatterCache.get(fractionDigits);
  if (cached) return cached;

  const formatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  });
  formatterCache.set(fractionDigits, formatter);
  return formatter;
};

/**
 * Campo monetário no padrão de PDV brasileiro.
 *
 * A digitação trabalha em unidades mínimas da escala configurada:
 * - fractionDigits=2: 1 -> 0,01 | 1234 -> 12,34
 * - fractionDigits=4: 1 -> 0,0001 | 12345 -> 1,2345
 *
 * Valores negativos são opt-in. Isso é necessário para conferências digitais
 * (Pix/cartão) que podem ficar líquidas negativas quando o turno atual devolve
 * vendas de turnos anteriores. Dinheiro físico continua positivo por domínio.
 *
 * O componente entrega ao domínio apenas o valor numérico já convertido;
 * validação financeira, limites e arredondamento continuam responsabilidade do backend.
 */
export const MoneyInput: React.FC<MoneyInputProps> = ({
  value,
  onValueChange,
  selectOnFocus = false,
  fractionDigits = 2,
  allowNegative = false,
  onFocus,
  onKeyDown,
  ...props
}) => {
  const safeFractionDigits = Number.isInteger(fractionDigits)
    ? Math.min(Math.max(fractionDigits, 0), 6)
    : 2;
  const scale = 10 ** safeFractionDigits;
  const formatter = formatterFor(safeFractionDigits);
  const displayValue = value === ''
    ? ''
    : formatter.format(Number(value));

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const isNegative = allowNegative && raw.trimStart().startsWith('-');
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      onValueChange('');
      return;
    }

    const units = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(units)) return;

    const parsed = units / scale;
    onValueChange(isNegative ? -parsed : parsed);
  };

  const handleFocus = (event: React.FocusEvent<HTMLInputElement>) => {
    if (selectOnFocus) event.currentTarget.select();
    onFocus?.(event);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (allowNegative && event.key === '-') {
      event.preventDefault();
      if (value === '') {
        onValueChange(-0);
      } else {
        const current = Number(value);
        const isCurrentlyNegative = current < 0 || Object.is(current, -0);
        onValueChange(isCurrentlyNegative ? Math.abs(current) : (current === 0 ? -0 : -current));
      }
    }
    onKeyDown?.(event);
  };

  return (
    <input
      {...props}
      type="text"
      inputMode={allowNegative ? 'decimal' : 'numeric'}
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
    />
  );
};

export default MoneyInput;
