import clsx from 'clsx';
import { Lock, Moon, Sun } from 'lucide-react';
import { nextKomaTheme, persistKomaTheme } from '../../../config/theme';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import { CASHIER_SIDEBAR_SECONDARY_ITEMS } from './cashierNavigation';

type Props = Pick<CashierSidebarProps,
  'hasOnlineMenu' | 'handleSidebarNavigation' | 'changeFontSize' | 'fontSize' |
  'setTheme' | 'theme' | 'activeWaiterNome'
> & { mobile?: boolean };

/** Shared footer content; each sidebar keeps its own container, focus and close behavior. */
export function CashierSidebarFooter({
  hasOnlineMenu, handleSidebarNavigation, changeFontSize, fontSize,
  setTheme, theme, activeWaiterNome, mobile = false,
}: Props) {
  return <>
    <div className="cashier-sidebar__secondary">
      <span className="cashier-sidebar__secondary-label">Acesso rápido</span>
      {CASHIER_SIDEBAR_SECONDARY_ITEMS.map((item) => {
        const Icon = item.icon;
        const isLocked = item.id === 'cardapio_digital' && !hasOnlineMenu;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSidebarNavigation(item.id, mobile)}
            className="cashier-nav-item flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-[11px] font-semibold text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground"
            title={mobile ? undefined : item.label}
          >
            <span className="cashier-nav-icon">
              <Icon size={14} />
            </span>
            <span className="cashier-nav-label">{item.label}</span>
            {isLocked && <Lock size={10} className="ml-auto text-amber-500" />}
          </button>
        );
      })}
    </div>
    <div className="cashier-display-controls">
      <div className="cashier-font-control flex-1">
        <span className="cashier-font-control__label">Texto</span>
        <div className="cashier-font-control__options">
          {(['padrao', 'grande', 'gigante'] as const).map((sz) => (
            <button
              key={sz}
              type="button"
              onClick={() => changeFontSize(sz)}
              className={clsx('cashier-font-control__button', fontSize === sz && 'is-active')}
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
        <span className="cashier-font-control__label">Tema</span>
        <div className="cashier-font-control__options">
          <button
            type="button"
            onClick={() => {
              setTheme(persistKomaTheme(nextKomaTheme(theme)));
            }}
            className={"cashier-font-control__button flex items-center justify-center py-1"}
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
        <small>Operador</small>
        <strong>{activeWaiterNome}</strong>
      </span>
    </div>

  </>;
}
