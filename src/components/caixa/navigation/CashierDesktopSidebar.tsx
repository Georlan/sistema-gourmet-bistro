import clsx from 'clsx';
import { SlidersHorizontal } from 'lucide-react';
import React from 'react';
import { KomaLogo } from '../../KomaLogo';
import { ONBOARDING_SETUP_MODE_KEY } from '../../onboarding/FirstAccessOnboarding';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from '../../ui/sidebar';
import { OnlineOrderEmergencyControl } from '../online-menu/OnlineOrderEmergencyControl';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import { getCashierSidebarGroupsForPlan } from './cashierNavigation';
import { CashierOnboardingShortcut } from './CashierOnboardingShortcut';
import { CashierSidebarFooter } from './CashierSidebarFooter';
import { CashierSidebarNavigation } from './CashierSidebarNavigation';
import { CashierSidebarSearch } from './CashierSidebarSearch';

type BoundaryProps = CashierSidebarProps;

function readSetupMode(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_SETUP_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Desktop shell; Navigation Tree v2 owns the actual information architecture. */
export function CashierDesktopSidebar({
  setIsOperatorDrawerOpen,
  turno,
  turnoLoadState,
  setShowAbrirModal,
  planId,
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
  const setupMode = readSetupMode();
  const shiftKnown = turnoLoadState === 'loaded';
  const shiftOpen = shiftKnown && turno?.status === 'aberto';
  const shiftClosed = shiftKnown && !turno;
  const shiftLabel = shiftOpen
    ? 'Caixa Aberto'
    : shiftClosed
      ? 'Caixa Fechado'
      : turnoLoadState === 'error'
        ? 'Estado indisponível'
        : 'Sincronizando caixa';

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
              <small>{setupMode ? 'Configuração inicial' : 'Se você está com fome, Kôma'}</small>
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

        {!setupMode && (
          <div className={clsx('cashier-shift-card', shiftOpen ? 'is-open' : shiftClosed ? 'is-closed' : 'is-loading')}>
            <div className="cashier-shift-card__status">
              <span className="cashier-shift-card__dot" />
              <span className="cashier-shift-card__copy">
                <small>Turno atual</small>
                <strong>{shiftLabel}</strong>
              </span>
            </div>
            {shiftClosed && (
              <button onClick={() => setShowAbrirModal(true)} className="cashier-shift-card__action is-open">
                Abrir caixa
              </button>
            )}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="cashier-sidebar__content p-2">
        <div className="mb-2">
          {setupMode ? (
            <CashierOnboardingShortcut />
          ) : (
            <CashierSidebarSearch
              groups={getCashierSidebarGroupsForPlan(planId)}
              hasOnlineMenu={hasOnlineMenu}
              handleSidebarNavigation={handleSidebarNavigation}
            />
          )}
        </div>
        {setupMode ? (
          <div className="rounded-xl border border-koma-border bg-koma-raised/40 p-3 text-[10px] leading-relaxed text-koma-muted group-data-[collapsible=icon]:hidden">
            Conclua dados do restaurante, horários e cardápio. A operação será liberada depois desses 3 passos.
          </div>
        ) : (
          <CashierSidebarNavigation
            groups={getCashierSidebarGroupsForPlan(planId)}
            hasOnlineMenu={hasOnlineMenu}
            isSidebarTabActive={isSidebarTabActive}
            sidebarOrderCount={sidebarOrderCount}
            handleSidebarNavigation={handleSidebarNavigation}
          />
        )}
      </SidebarContent>

      <SidebarFooter className="cashier-sidebar__footer p-3 flex flex-col gap-2">
        {!setupMode && hasOnlineMenu && <OnlineOrderEmergencyControl />}
        <CashierSidebarFooter
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