import clsx from 'clsx';
import { SlidersHorizontal } from 'lucide-react';
import React from 'react';
import { KomaLogo } from '../../KomaLogo';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '../../ui/sidebar';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import { CASHIER_SIDEBAR_GROUPS } from './cashierNavigation';
import { CashierSidebarFooter } from './CashierSidebarFooter';
import { CashierSidebarNavigation } from './CashierSidebarNavigation';

type BoundaryProps = CashierSidebarProps;

/** Desktop shell; Navigation Tree v2 owns the actual information architecture. */
export function CashierDesktopSidebar({
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
    <Sidebar
      collapsible="icon"
      className="cashier-sidebar hidden lg:flex flex-col justify-between shrink-0"
    >
      <SidebarHeader className="cashier-sidebar__header p-3.5">
        <div className="cashier-sidebar__brand-row">
          <div className="cashier-sidebar__brand">
            <span className="cashier-sidebar__logo-wrap cashier-sidebar__logo-wrap--expanded">
              <KomaLogo size="md" />
            </span>
            <span
              className="cashier-sidebar__logo-wrap cashier-sidebar__logo-wrap--compact"
              aria-hidden="true"
            >
              <KomaLogo size="md" contextualWordmark={false} alt="" />
            </span>
            <span className="cashier-sidebar__brand-copy">
              <strong>Kôma</strong>
              <small>Se você está com fome, Kôma</small>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsOperatorDrawerOpen(true)}
            className="cashier-sidebar__utility-button"
            title="Conta e preferências"
            aria-label="Abrir conta e preferências"
          >
            <SlidersHorizontal size={15} />
          </button>
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
            <button onClick={() => setShowAbrirModal(true)} className="cashier-shift-card__action is-open">
              Abrir caixa
            </button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="cashier-sidebar__content p-2">
        <CashierSidebarNavigation
          groups={CASHIER_SIDEBAR_GROUPS}
          hasOnlineMenu={hasOnlineMenu}
          isSidebarTabActive={isSidebarTabActive}
          sidebarOrderCount={sidebarOrderCount}
          handleSidebarNavigation={handleSidebarNavigation}
        />
      </SidebarContent>

      <SidebarFooter className="cashier-sidebar__footer p-3 flex flex-col gap-2">
        <CashierSidebarFooter
          hasOnlineMenu={hasOnlineMenu}
          handleSidebarNavigation={handleSidebarNavigation}
          changeFontSize={changeFontSize}
          fontSize={fontSize}
          setTheme={setTheme}
          theme={theme}
          activeWaiterNome={activeWaiterNome}
        />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
