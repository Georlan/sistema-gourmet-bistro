import type { CashierSidebarProps } from './cashierNavigationContracts';
import type { useCashierNavigation } from './useCashierNavigation';
import clsx from 'clsx';
import { Lock, Moon, SlidersHorizontal, Sun, X } from 'lucide-react';
import React from 'react';
import { nextKomaTheme, persistKomaTheme, type KomaTheme } from '../../../config/theme';
import type { CaixaTurno } from '../../../types';
import { KomaLogo } from '../../KomaLogo';
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../../ui/sidebar';
import { CASHIER_SIDEBAR_GROUPS, CASHIER_SIDEBAR_SECONDARY_ITEMS } from './cashierNavigation';
type BoundaryProps = CashierSidebarProps &
  Pick<ReturnType<typeof useCashierNavigation>, 'isMobileSidebarOpen' | 'setIsMobileSidebarOpen'>;

/** Mobile navigation using the persistent navigation controller. */
export function CashierMobileSidebar({
  isMobileSidebarOpen,
  setIsMobileSidebarOpen,
  setIsOperatorDrawerOpen,
  turno,
  setShowAbrirModal,
  hasOnlineMenu,
  isSidebarTabActive,
  sidebarOrderCount,
  handleSidebarNavigation,
  changeFontSize,
  fontSize,
  setTheme,
  theme,
  activeWaiterNome,
}: BoundaryProps) {
  return (
    <>
      {isMobileSidebarOpen && (
        <div className={"fixed inset-0 z-50 flex lg:hidden animate-fade-in"}>
          <div
            onClick={() => setIsMobileSidebarOpen(false)}
            className={"fixed inset-0 bg-black/80 backdrop-blur-sm"}
          />
          <aside
            id="mobile-caixa-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
            className={"cashier-sidebar cashier-sidebar--mobile relative w-[17rem] max-w-[88vw] flex flex-col justify-between shrink-0 h-full z-10 shadow-2xl overflow-y-auto"}
          >
            <SidebarHeader className={"cashier-sidebar__header p-3"}>
              <div className="cashier-sidebar__brand-row">
                <div className="cashier-sidebar__brand">
                  <span className="cashier-sidebar__logo-wrap">
                    <KomaLogo size="md" />
                  </span>
                  <span className="cashier-sidebar__brand-copy">
                    <strong>Kôma</strong>
                    <small>Se você está com fome, Kôma</small>
                  </span>
                </div>
                <div className={"flex items-center gap-1.5"}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsOperatorDrawerOpen(true);
                      setIsMobileSidebarOpen(false);
                    }}
                    className="cashier-sidebar__utility-button"
                    title="Conta e preferências"
                    aria-label="Abrir conta e preferências"
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMobileSidebarOpen(false)}
                    className="cashier-sidebar__utility-button"
                    aria-label="Fechar menu"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Status do Turno */}
              <div
                className={clsx('cashier-shift-card', turno?.status === 'aberto' ? 'is-open' : 'is-closed')}
              >
                <div className="cashier-shift-card__status">
                  <span className="cashier-shift-card__dot" />
                  <span className="cashier-shift-card__copy">
                    <small>Turno atual</small>
                    <strong>{turno?.status === 'aberto' ? 'Caixa Aberto' : 'Caixa Fechado'}</strong>
                  </span>
                </div>
                {turno?.status !== 'aberto' && (
                  <button
                    onClick={() => {
                      setShowAbrirModal(true);
                      setIsMobileSidebarOpen(false);
                    }}
                    className={"cashier-shift-card__action is-open"}
                  >
                    Abrir caixa
                  </button>
                )}
              </div>
            </SidebarHeader>

            <SidebarContent className={"cashier-sidebar__content p-2"}>
              {CASHIER_SIDEBAR_GROUPS.map((group) => (
                <SidebarGroup key={group.category}>
                  <SidebarGroupLabel className="cashier-nav-group-label">{group.category}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((tab) => {
                        const Icon = tab.icon;
                        const isLocked = tab.id === 'cardapio_digital' && !hasOnlineMenu;
                        const isActive = isSidebarTabActive(tab.id);
                        const orderCount = tab.id === 'operacao' ? sidebarOrderCount : 0;

                        return (
                          <SidebarMenuItem key={tab.id}>
                            <SidebarMenuButton
                              isActive={isActive}
                              onClick={() => handleSidebarNavigation(tab.id, true)}
                              className="cashier-nav-item"
                              title={tab.label}
                            >
                              <span className="cashier-nav-icon">
                                <Icon size={15} />
                              </span>
                              <span className="cashier-nav-label">{tab.label}</span>
                              {orderCount > 0 && <SidebarMenuBadge>{orderCount}</SidebarMenuBadge>}
                              {isLocked && (
                                <span className="cashier-nav-plan">
                                  <Lock size={9} />
                                  <span>Plano</span>
                                </span>
                              )}
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </SidebarContent>

            <SidebarFooter className={"cashier-sidebar__footer p-3 flex flex-col gap-2"}>
              <div className="cashier-sidebar__secondary">
                <span className="cashier-sidebar__secondary-label">Acesso rápido</span>
                {CASHIER_SIDEBAR_SECONDARY_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isLocked = item.id === 'cardapio_digital' && !hasOnlineMenu;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSidebarNavigation(item.id, true)}
                      className="cashier-nav-item flex min-h-8 items-center gap-2 rounded-lg px-2 text-left text-[11px] font-semibold text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground"
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

              <div className="cashier-operator">
                <span className="cashier-operator__avatar">
                  {activeWaiterNome?.trim().charAt(0).toUpperCase() || 'K'}
                </span>
                <span className="cashier-operator__copy">
                  <small>Operador</small>
                  <strong>{activeWaiterNome}</strong>
                </span>
              </div>
            </SidebarFooter>
          </aside>
        </div>
      )}
    </>
  );
}
