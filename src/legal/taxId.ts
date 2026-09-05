export function normalizeTaxId(value: string): string {
  return value.replace(/\D+/g, '');
}

function hasRepeatedDigits(value: string): boolean {
  return value.length > 0 && new Set(value.split('')).size === 1;
}

export function isValidCpf(value: string): boolean {
  const digits = normalizeTaxId(value);
  if (digits.length !== 11 || hasRepeatedDigits(digits)) return false;
  const numbers = digits.split('').map(Number);
  let sum = 0;
  for (let index = 0; index < 9; index += 1) sum += numbers[index] * (10 - index);
  let first = (sum * 10) % 11;
  if (first === 10) first = 0;
  if (first !== numbers[9]) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) sum += numbers[index] * (11 - index);
  let second = (sum * 10) % 11;
  if (second === 10) second = 0;
  return second === numbers[10];
}

export function isValidCnpj(value: string): boolean {
  const digits = normalizeTaxId(value);
  if (digits.length !== 14 || hasRepeatedDigits(digits)) return false;
  const numbers = digits.split('').map(Number);
  const calculate = (base: number[], weights: number[]) => {
    const total = base.reduce((acc, number, index) => acc + number * weights[index], 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(numbers.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (first !== numbers[12]) return false;
  const second = calculate(numbers.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return second === numbers[13];
}

export function taxIdKind(value: string): 'cpf' | 'cnpj' | null {
  const digits = normalizeTaxId(value);
  if (digits.length === 11 && isValidCpf(digits)) return 'cpf';
  if (digits.length === 14 && isValidCnpj(digits)) return 'cnpj';
  return null;
}
