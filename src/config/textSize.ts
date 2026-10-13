export type KomaTextSize = 'padrao' | 'grande' | 'gigante';
export const KOMA_TEXT_SIZE_EVENT = 'koma_font_size_changed';
export const KOMA_TEXT_SCALES: Record<KomaTextSize, number> = { padrao: 1, grande: 1.2, gigante: 1.4 };
export function normalizeKomaTextSize(value: unknown): KomaTextSize {
  return value === 'grande' || value === 'gigante' ? value : 'padrao';
}
export function readKomaTextSize(): KomaTextSize {
  try { return normalizeKomaTextSize(localStorage.getItem('koma_font_size')); }
  catch { return 'padrao'; }
}
export function persistKomaTextSize(value: KomaTextSize): KomaTextSize {
  const size = normalizeKomaTextSize(value);
  try { localStorage.setItem('koma_font_size', size); } catch { /* Preference still works for this session. */ }
  window.dispatchEvent(new CustomEvent(KOMA_TEXT_SIZE_EVENT, { detail: size }));
  return size;
}
