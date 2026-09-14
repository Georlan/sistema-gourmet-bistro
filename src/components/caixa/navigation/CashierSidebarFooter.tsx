import { CircleHelp } from 'lucide-react';
import { openCustomerSupport } from '../../app/customerSupportEvents';
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
    <>
      <button
        type="button"
        onClick={openCustomerSupport}
        className="flex w-full items-center gap-2 rounded-xl border border-koma-border bg-koma-raised/40 px-3 py-2.5 text-left text-xs font-bold text-koma-foreground transition hover:bg-koma-raised group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2"
        title="Ajuda e feedback"
        aria-label="Abrir ajuda e feedback"
      >
        <CircleHelp size={16} className="shrink-0 text-koma-accent" />
        <span className="group-data-[collapsible=icon]:hidden">Ajuda e feedback</span>
      </button>

      <div className="cashier-operator">
        <span className="cashier-operator__avatar">
          {activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}
        </span>
        <span className="cashier-operator__copy">
          <small style={{ color: 'var(--koma-text-secondary)' }}>Operador</small>
          <strong>{activeWaiterNome}</strong>
        </span>
      </div>
    </>
  );
}
