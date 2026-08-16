export type KomaTheme = 'dark' | 'light';

export const KOMA_THEME_STORAGE_KEY = '@koma:theme';
export const KOMA_THEME_CHANGED_EVENT = 'koma_theme_changed';
export const DEFAULT_KOMA_THEME: KomaTheme = 'dark';

export const isKomaTheme = (value: unknown): value is KomaTheme =>
  value === 'dark' || value === 'light';

export const readKomaTheme = (
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): KomaTheme => {
  const stored = storage.getItem(KOMA_THEME_STORAGE_KEY);
  return isKomaTheme(stored) ? stored : DEFAULT_KOMA_THEME;
};

export const applyKomaTheme = (
  theme: KomaTheme,
  root: HTMLElement = document.documentElement,
): KomaTheme => {
  root.setAttribute('data-koma-theme', theme);
  return theme;
};

export const initializeKomaTheme = (): KomaTheme => applyKomaTheme(readKomaTheme());

export const persistKomaTheme = (
  theme: KomaTheme,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): KomaTheme => {
  storage.setItem(KOMA_THEME_STORAGE_KEY, theme);
  applyKomaTheme(theme);
  window.dispatchEvent(new Event(KOMA_THEME_CHANGED_EVENT));
  return theme;
};

export const nextKomaTheme = (theme: KomaTheme): KomaTheme =>
  theme === 'dark' ? 'light' : 'dark';
