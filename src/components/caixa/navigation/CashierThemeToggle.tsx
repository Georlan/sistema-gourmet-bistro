import { Moon, Sun } from 'lucide-react';
import { nextKomaTheme, persistKomaTheme, readKomaTheme, type KomaTheme } from '../../../config/theme';

export function CashierThemeToggle({ theme }: { theme: KomaTheme }) {
  const label = theme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro';
  return (
    <button type="button" id="btn-caixa-theme" className="cashier-theme-toggle"
      aria-label={label} title={label}
      onClick={() => persistKomaTheme(nextKomaTheme(readKomaTheme()))}>
      <span className="cashier-theme-toggle__symbols" data-theme={theme} aria-hidden="true">
        <Sun className="cashier-theme-toggle__sun" size={19} />
        <Moon className="cashier-theme-toggle__moon" size={19} />
      </span>
    </button>
  );
}
