/** Preview only; the server owns conflict handling and tenant isolation. */
export function previewTableRange(first: string, last: string, capacity: string, existingIds: readonly number[]) {
  const start = Number(first), end = Number(last), seats = Number(capacity);
  const empty = { ids: [] as number[], preserved: 0 };
  if (!first || !last || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 300 || end < start) {
    return { ...empty, error: 'Informe um intervalo de 1 a 300, com o último número igual ou maior que o primeiro.' };
  }
  if (!capacity || !Number.isInteger(seats) || seats < 1 || seats > 50) {
    return { ...empty, error: 'Informe de 1 a 50 lugares por mesa.' };
  }
  const existing = new Set(existingIds);
  const ids = Array.from({ length: end - start + 1 }, (_, index) => start + index).filter(id => !existing.has(id));
  return { ids, preserved: end - start + 1 - ids.length, error: '' };
}
