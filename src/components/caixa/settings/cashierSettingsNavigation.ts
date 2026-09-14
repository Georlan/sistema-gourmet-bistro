export type CashierSettingsTab = 'aparencia' | 'impressao' | 'mesas' | 'garcom' | 'taxa';

export const CASHIER_SETTINGS_TAB_STORAGE_KEY = 'koma_cashier_settings_tab';
export const CASHIER_SETTINGS_TAB_REQUEST_EVENT = 'koma-cashier-settings-tab-request';

export function isCashierSettingsTab(value: unknown): value is CashierSettingsTab {
  return value === 'aparencia'
    || value === 'impressao'
    || value === 'mesas'
    || value === 'garcom'
    || value === 'taxa';
}

export function readInitialCashierSettingsTab(): CashierSettingsTab {
  if (typeof window === 'undefined') return 'aparencia';
  try {
    const stored = window.localStorage.getItem(CASHIER_SETTINGS_TAB_STORAGE_KEY);
    return isCashierSettingsTab(stored) ? stored : 'aparencia';
  } catch {
    return 'aparencia';
  }
}

export function persistCashierSettingsTab(tab: CashierSettingsTab) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CASHIER_SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Preferência local é melhoria de ergonomia; falha de storage não deve bloquear o Caixa.
  }
}

export function requestCashierSettingsTab(tab: CashierSettingsTab) {
  persistCashierSettingsTab(tab);
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CashierSettingsTab>(CASHIER_SETTINGS_TAB_REQUEST_EVENT, {
    detail: tab,
  }));
}

export function getRequestedCashierSettingsTab(event: Event): CashierSettingsTab | null {
  const requested = (event as CustomEvent<unknown>).detail;
  return isCashierSettingsTab(requested) ? requested : null;
}
