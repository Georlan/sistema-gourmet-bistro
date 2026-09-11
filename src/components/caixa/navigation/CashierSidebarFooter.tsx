import type { CashierSidebarProps } from './cashierNavigationContracts';
import './cashierLowHeight.css';
import './cashierLightContrast.css';
import './cashierCompactLayout.css';

type Props = Pick<
  CashierSidebarProps,
  'changeFontSize' | 'fontSize' | 'setTheme' | 'theme' | 'activeWaiterNome'
> & { mobile?: boolean };

/**
 * Rodapé operacional da navegação.
 *
 * Tema e tamanho de texto pertencem a Conta e preferências; repetir esses
 * controles aqui consome a área mais valiosa do Caixa em monitores baixos.
 */
export function CashierSidebarFooter({ activeWaiterNome }: Props) {
  return (
    <div className="cashier-operator">
      <span className="cashier-operator__avatar">
        {activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}
      </span>
      <span className="cashier-operator__copy">
        <small style={{ color: 'var(--koma-text-secondary)' }}>Operador</small>
        <strong>{activeWaiterNome}</strong>
      </span>
    </div>
  );
}
