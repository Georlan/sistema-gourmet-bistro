import { KomaLogo } from '../../KomaLogo';
import { ChevronRight } from 'lucide-react';
import { CashierFooterArt } from './CashierFooterArt';
import { StoreSwitchButton } from '../../auth/StoreSwitchButton';
import { openCustomerSupport } from '../../app/customerSupportEvents';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import './cashierLowHeight.css';
import './cashierSidebarFooter.css';
import './cashierCompactLayout.css';

type Props = Pick<
  CashierSidebarProps,
  'changeFontSize' | 'fontSize' | 'setTheme' | 'theme' | 'activeWaiterNome' | 'restaurantName' | 'restaurantLogo'
> & { mobile?: boolean; onRestaurantClick?: () => void };

/**
 * Rodapé operacional da navegação.
 *
 * Tema e tamanho de texto ficam no cabeçalho; repetir esses
 * controles aqui consome a área mais valiosa do Caixa em monitores baixos.
 */
export function CashierSidebarFooter({ restaurantName, restaurantLogo, onRestaurantClick }: Props) {
  return (
    <>
      <StoreSwitchButton />
      <button
        type="button"
        onClick={openCustomerSupport}
        className="cashier-footer-help"
        title="Ajuda e feedback"
        aria-label="Abrir ajuda e feedback"
      >
        <CashierFooterArt kind="help" />
        <span className="cashier-footer-help__label">Ajuda e feedback</span>
        <ChevronRight className="cashier-footer-help__arrow" size={16} aria-hidden="true" />
      </button>

      <button type="button" className="cashier-operator" onClick={onRestaurantClick}
        title={`${restaurantName || 'Restaurante'} · Aparência`} aria-label={`Aparência de ${restaurantName || 'Restaurante'}`}>
        <span className="cashier-operator__avatar" aria-hidden="true">
          {restaurantLogo ? <img src={restaurantLogo} alt="" width="40" height="40" loading="lazy" decoding="async" /> : <KomaLogo size="sm" variant="dark" contextualWordmark={false} alt="" />}
        </span>
        <span className="cashier-operator__copy"><strong>{restaurantName || 'Restaurante'}</strong></span>
        <ChevronRight className="cashier-operator__arrow" size={16} aria-hidden="true" />
      </button>
    </>
  );
}
