export function normalizeTaxId(value: string): string {
  return String(value || '').trim().toUpperCase().replace(/[.\-/\s]+/g, '');
}

function hasRepeatedCharacters(value: string): boolean {
  return value.length > 0 && new Set(value.split('')).size === 1;
}

export function isValidCpf(value: string): boolean {
  const digits = normalizeTaxId(value);
  if (!/^\d{11}$/.test(digits) || hasRepeatedCharacters(digits)) return false;
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
  const cnpj = normalizeTaxId(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(cnpj) || hasRepeatedCharacters(cnpj)) return false;

  const baseValues = cnpj.slice(0, 12).split('').map(char => char.charCodeAt(0) - 48);
  const calculate = (base: number[], weights: number[]) => {
    const total = base.reduce((acc, item, index) => acc + item * weights[index], 0);
    const remainder = total % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const first = calculate(baseValues, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate([...baseValues, first], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return cnpj.slice(12) === `${first}${second}`;
}

export function taxIdKind(value: string): 'cpf' | 'cnpj' | null {
  const normalized = normalizeTaxId(value);
  if (isValidCpf(normalized)) return 'cpf';
  if (isValidCnpj(normalized)) return 'cnpj';
  return null;
}
