export const KOMA_OPEN_CUSTOMER_SUPPORT_EVENT = 'koma-open-customer-support';

/**
 * Abre a central de ajuda somente dentro de uma superfície operacional já autenticada.
 * O drawer em si continua validando a sessão antes de renderizar ou enviar qualquer mensagem.
 */
export function openCustomerSupport(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(KOMA_OPEN_CUSTOMER_SUPPORT_EVENT));
}
