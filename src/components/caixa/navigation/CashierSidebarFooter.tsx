import clsx from 'clsx';
import { Moon, Sun } from 'lucide-react';
import { nextKomaTheme, persistKomaTheme } from '../../../config/theme';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import './cashierLowHeight.css';

type Props = Pick<
  CashierSidebarProps,
  'changeFontSize' | 'fontSize' | 'setTheme' | 'theme' | 'activeWaiterNome'
> & { mobile?: boolean };

/** Shared footer content; navigation destinations belong to Navigation Tree v2. */
export function CashierSidebarFooter({
  changeFontSize, fontSize, setTheme, theme, activeWaiterNome, mobile = false,
}: Props) {
  return <>
    <div className="cashier-display-controls">
      <div className="cashier-font-control flex-1">
        <span
          className="cashier-font-control__label"
          style={{ color: 'var(--koma-text-secondary)' }}
        >
          Texto
        </span>
        <div
          className="cashier-font-control__options"
          style={{ borderColor: 'var(--koma-border-strong)', background: 'var(--koma-surface-raised)' }}
        >
          {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() => changeFontSize(sz)}
              className={clsx('cashier-font-control__button', fontSize === sz && 'is-active')}
              style={fontSize === sz ? undefined : { color: 'var(--koma-text-secondary)' }}
              aria-label={
                sz === 'padrao'
                  ? 'Texto padrão'
                  : sz === 'grande'
                    ? 'Texto grande'
                    : 'Texto muito grande'
              }
              title={
                sz === 'padrao'
                  ? 'Texto padrão'
                  : sz === 'grande'
                    ? 'Texto grande'
                    : 'Texto muito grande'
              }
            >
              {sz === 'padrao' ? 'A' : sz === 'grande' ? 'A+' : 'A++'}
            </button>
          ))}
        </div>
      </div>

      <div className="cashier-font-control">
        <span
          className="cashier-font-control__label"
          style={{ color: 'var(--koma-text-secondary)' }}
        >
          Tema
        </span>
        <div
          className="cashier-font-control__options"
          style={{ borderColor: 'var(--koma-border-strong)', background: 'var(--koma-surface-raised)' }}
        >
          <button
            type="button"
            onClick={() => {
              setTheme(persistKomaTheme(nextKomaTheme(theme)));
            }}
            className="cashier-font-control__button flex items-center justify-center py-1"
            style={{ color: 'var(--koma-text-secondary)' }}
            aria-label="Alternar tema"
            title="Alternar tema"
          >
            {theme === 'dark' ? <Moon size={12} /> : <Sun size={12} />}
          </button>
        </div>
      </div>
    </div>

    {!mobile && (
      <button
        type="button"
        onClick={() => setTheme(persistKomaTheme(nextKomaTheme(theme)))}
        className="cashier-sidebar__compact-theme"
        aria-label="Alternar tema"
        title="Alternar tema"
      >
        {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
      </button>
    )}

    <div className="cashier-operator">
      <span className="cashier-operator__avatar">
        {activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}
      </span>
      <span className="cashier-operator__copy">
        <small style={{ color: 'var(--koma-text-secondary)' }}>Operador</small>
        <strong>{activeWaiterNome}</strong>
      </span>
    </div>
  </>;
}
