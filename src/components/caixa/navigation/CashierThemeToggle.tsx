import { Moon, Sun } from 'lucide-react';
import { nextKomaTheme, persistKomaTheme, readKomaTheme, type KomaTheme } from '../../../config/theme';
import { useKomaThemeTransition } from '../../shared/useKomaThemeTransition';

export function CashierThemeToggle({ theme }: { theme: KomaTheme }) {
  const transition = useKomaThemeTransition(false);
  const label = theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro';
  return (
    <button type="button" id="btn-caixa-theme" className="cashier-theme-toggle"
      aria-label={label} title={label} disabled={transition.animating}
      onClick={event => transition.change(event.currentTarget, () => persistKomaTheme(nextKomaTheme(readKomaTheme())), document.querySelectorAll('.orders-card').length > 30)}>
      <span className="cashier-theme-toggle__symbols" data-theme={theme} aria-hidden="true">
        <Sun className="cashier-theme-toggle__sun" size={19} />
        <Moon className="cashier-theme-toggle__moon" size={19} />
      </span>
    </button>
  );
}
