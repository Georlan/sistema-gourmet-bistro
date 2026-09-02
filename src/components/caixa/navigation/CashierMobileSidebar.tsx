import clsx from 'clsx';
import { SlidersHorizontal, X } from 'lucide-react';
import React from 'react';
import { KomaLogo } from '../../KomaLogo';
import { SidebarContent, SidebarFooter, SidebarHeader } from '../../ui/sidebar';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import { CASHIER_SIDEBAR_GROUPS } from './cashierNavigation';
import { CashierSidebarFooter } from './CashierSidebarFooter';
import { CashierSidebarNavigation } from './CashierSidebarNavigation';
import type { useCashierNavigation } from './useCashierNavigation';

type BoundaryProps = CashierSidebarProps &
  Pick<ReturnType<typeof useCashierNavigation>, 'isMobileSidebarOpen' | 'setIsMobileSidebarOpen'>;

/** Mobile shell; Navigation Tree v2 owns the actual information architecture. */
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
        <div className="fixed inset-0 z-50 flex lg:hidden animate-fade-in">
          <div
            onClick={() => setIsMobileSidebarOpen(false)}
            className="fixed inset-0 bg-black/80 backdrop-blur-sm"
          />
          <aside
            id="mobile-caixa-sidebar"
            role="dialog"
            aria-modal="true"
            aria-label="Menu principal"
            className="cashier-sidebar cashier-sidebar--mobile relative w-[17rem] max-w-[88vw] flex flex-col justify-between shrink-0 h-full z-10 shadow-2xl overflow-y-auto"
          >
            <SidebarHeader className="cashier-sidebar__header p-3">
              <div className="cashier-sidebar__brand-row">
                <div className="cashier-sidebar__brand">
                  <span className="cashier-sidebar__logo-wrap"><KomaLogo size="md" /></span>
                  <span className="cashier-sidebar__brand-copy">
                    <strong>Kôma</strong>
                    <small>Se você está com fome, Kôma</small>
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
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

              <div className={clsx('cashier-shift-card', turno?.status === 'aberto' ? 'is-open' : 'is-closed')}>
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
                    className="cashier-shift-card__action is-open"
                  >
                    Abrir caixa
                  </button>
                )}
              </div>
            </SidebarHeader>

            <SidebarContent className="cashier-sidebar__content p-2">
              <CashierSidebarNavigation
                groups={CASHIER_SIDEBAR_GROUPS}
                closeMobile
                hasOnlineMenu={hasOnlineMenu}
                isSidebarTabActive={isSidebarTabActive}
                sidebarOrderCount={sidebarOrderCount}
                handleSidebarNavigation={handleSidebarNavigation}
              />
            </SidebarContent>

            <SidebarFooter className="cashier-sidebar__footer p-3 flex flex-col gap-2">
              <CashierSidebarFooter
                mobile
                hasOnlineMenu={hasOnlineMenu}
                handleSidebarNavigation={handleSidebarNavigation}
                changeFontSize={changeFontSize}
                fontSize={fontSize}
                setTheme={setTheme}
                theme={theme}
                activeWaiterNome={activeWaiterNome}
              />
            </SidebarFooter>
          </aside>
        </div>
      )}
    </>
  );
}
