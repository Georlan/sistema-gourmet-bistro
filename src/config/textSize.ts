export type KomaTextSize = 'padrao' | 'grande' | 'gigante';
export const KOMA_TEXT_SIZE_EVENT = 'koma_font_size_changed';
export const KOMA_TEXT_SCALES: Record<KomaTextSize, number> = { padrao: 1, grande: 1.2, gigante: 1.4 };
export function normalizeKomaTextSize(value: unknown): KomaTextSize {
  return value === 'grande' || value === 'gigante' ? value : 'padrao';
}
export function normalizeWaiterTextSize(value: unknown): 'padrao' | 'grande' {
  return value === 'grande' || value === 'gigante' ? 'grande' : 'padrao';
}
export function readKomaTextSize(): KomaTextSize {
  try {
    const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    return normalizeKomaTextSize(storage?.getItem('koma_font_size'));
  } catch {
    return 'padrao';
  }
}
export function persistKomaTextSize(value: KomaTextSize): KomaTextSize {
  const size = normalizeKomaTextSize(value);
  try {
    const storage = typeof window !== 'undefined' && window.localStorage ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null);
    storage?.setItem('koma_font_size', size);
  } catch { /* Preference still works for this session. */ }
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      const event = typeof CustomEvent === 'function' ? new CustomEvent(KOMA_TEXT_SIZE_EVENT, { detail: size }) : new Event(KOMA_TEXT_SIZE_EVENT);
      window.dispatchEvent(event);
    }
  } catch { /* Event dispatch failure is non-fatal. */ }
  return size;
}
