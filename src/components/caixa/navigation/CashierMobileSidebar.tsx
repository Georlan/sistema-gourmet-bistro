import clsx from 'clsx';
import { ClipboardList, Globe, SlidersHorizontal, Users, X } from 'lucide-react';
import React from 'react';
import { KomaLogo } from '../../KomaLogo';
import { ONBOARDING_SETUP_MODE_KEY } from '../../onboarding/FirstAccessOnboarding';
import { SidebarContent, SidebarFooter, SidebarHeader } from '../../ui/sidebar';
import { OnlineOrderEmergencyControl } from '../online-menu/OnlineOrderEmergencyControl';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import { getCashierSidebarGroupsForPlan } from './cashierNavigation';
import { CashierOnboardingShortcut } from './CashierOnboardingShortcut';
import { CashierSidebarFooter } from './CashierSidebarFooter';
import { CashierSidebarNavigation } from './CashierSidebarNavigation';
import { CashierSidebarSearch } from './CashierSidebarSearch';
import type { useCashierNavigation } from './useCashierNavigation';

type BoundaryProps = CashierSidebarProps &
  Pick<ReturnType<typeof useCashierNavigation>, 'isMobileSidebarOpen' | 'setIsMobileSidebarOpen'>;

function readSetupMode(): boolean {
  try {
    return sessionStorage.getItem(ONBOARDING_SETUP_MODE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mobile shell; Navigation Tree v2 owns the actual information architecture. */
export function CashierMobileSidebar({
  isMobileSidebarOpen,
  setIsMobileSidebarOpen,
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

  const mobileQuickActions = [
    { id: 'cardapio_produtos', label: 'Produtos', icon: ClipboardList },
    { id: 'clientes', label: 'Clientes', icon: Users },
    ...(hasOnlineMenu ? [{ id: 'online_perfil', label: 'Cardápio online', icon: Globe }] : []),
    { id: 'config_aparencia', label: 'Configurações', icon: SlidersHorizontal },
  ] as const;

  return (
    <>
      {isMobileSidebarOpen && (
        <div className="fixed inset-0 z-[80] flex lg:hidden animate-fade-in">
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
                    <small>{setupMode ? 'Configuração inicial' : 'Se você está com fome, Kôma'}</small>
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
              )}
            </SidebarHeader>

            <SidebarContent className="cashier-sidebar__content p-2">
              {!setupMode && (
                <div className="cashier-mobile-quick-actions" aria-label="Atalhos rápidos">
                  {mobileQuickActions.map((action) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => handleSidebarNavigation(action.id, true)}
                        className="cashier-mobile-quick-action"
                      >
                        <Icon size={17} />
                        <span>{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="mb-2">
                {setupMode ? (
                  <CashierOnboardingShortcut mobile />
                ) : (
                  <CashierSidebarSearch
                    groups={getCashierSidebarGroupsForPlan(planId)}
                    hasOnlineMenu={hasOnlineMenu}
                    handleSidebarNavigation={handleSidebarNavigation}
                    closeMobile
                  />
                )}
              </div>
              {setupMode ? (
                <div className="rounded-xl border border-koma-border bg-koma-raised/40 p-3 text-xs leading-relaxed text-koma-muted">
                  Você está na implantação inicial. Conclua dados, horários e cardápio antes de liberar a operação.
                </div>
              ) : (
                <CashierSidebarNavigation
                  groups={getCashierSidebarGroupsForPlan(planId)}
                  closeMobile
                  expandActiveChildren={false}
                  hasOnlineMenu={hasOnlineMenu}
                  isSidebarTabActive={isSidebarTabActive}
                  sidebarOrderCount={sidebarOrderCount}
                  handleSidebarNavigation={handleSidebarNavigation}
                />
              )}
            </SidebarContent>

            <SidebarFooter className="cashier-sidebar__footer cashier-sidebar__footer--mobile p-3 flex flex-col gap-2">
              {!setupMode && hasOnlineMenu && <OnlineOrderEmergencyControl mobile />}
              <CashierSidebarFooter
                mobile
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