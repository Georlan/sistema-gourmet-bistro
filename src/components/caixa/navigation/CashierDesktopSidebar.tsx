import type { CashierSidebarProps } from './cashierNavigationContracts';
import clsx from 'clsx';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import React from 'react';
import { KomaLogo } from '../../KomaLogo';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '../../ui/sidebar';
import { CASHIER_SIDEBAR_GROUPS, GESTAO_HUB_ITEMS } from './cashierNavigation';
import { CashierSidebarFooter } from './CashierSidebarFooter';
type BoundaryProps = CashierSidebarProps;

/** Desktop navigation using the same route definitions and navigation actions as mobile. */
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
  isGestaoExpanded,
}: BoundaryProps) {
  return (
    <>
      <Sidebar
        collapsible="icon"
        className={"cashier-sidebar hidden lg:flex flex-col justify-between shrink-0"}
      >
        <SidebarHeader className={"cashier-sidebar__header p-3.5"}>
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

          {/* Quick status bar */}
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
                onClick={() => setShowAbrirModal(true)}
                className={"cashier-shift-card__action is-open"}
              >
                Abrir caixa
              </button>
            )}
          </div>
        </SidebarHeader>

        {/* Sidebar Content — 5 main destinations */}
        <SidebarContent className={"cashier-sidebar__content p-2"}>
          {CASHIER_SIDEBAR_GROUPS.map((group) => (
            <SidebarGroup key={group.category || '__main'}>
              {group.category && (
                <span className="cashier-nav-group-label">{group.category}</span>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((tab) => {
                    const Icon = tab.icon;
                    const isActive = isSidebarTabActive(tab.id);
                    const orderCount = tab.id === 'operacao' ? sidebarOrderCount : 0;
                    const isHub = tab.id === 'gestao_hub';

                    return (
                      <React.Fragment key={tab.id}>
                        <SidebarMenuItem>
                          <SidebarMenuButton
                            isActive={isActive}
                            onClick={() => handleSidebarNavigation(tab.id)}
                            className="cashier-nav-item"
                            title={tab.label}
                          >
                            <span className="cashier-nav-icon">
                              <Icon size={15} />
                            </span>
                            <span className="cashier-nav-label">{tab.label}</span>
                            {orderCount > 0 && <SidebarMenuBadge>{orderCount}</SidebarMenuBadge>}
                            {isHub && (
                              <ChevronDown
                                size={12}
                                className={clsx(
                                  'ml-auto transition-transform duration-200 text-koma-muted',
                                  isGestaoExpanded && 'rotate-180',
                                )}
                              />
                            )}
                          </SidebarMenuButton>
                        </SidebarMenuItem>

                        {/* Gestão hub sub-items */}
                        {isHub && isGestaoExpanded && (
                          <div className="pl-4 flex flex-col gap-0.5">
                            {GESTAO_HUB_ITEMS.map((sub) => {
                              const SubIcon = sub.icon;
                              const isSubActive = isSidebarTabActive(sub.id);
                              return (
                                <SidebarMenuItem key={sub.id}>
                                  <SidebarMenuButton
                                    isActive={isSubActive}
                                    onClick={() => handleSidebarNavigation(sub.id)}
                                    className="cashier-nav-item"
                                    title={sub.label}
                                  >
                                    <span className="cashier-nav-icon">
                                      <SubIcon size={13} />
                                    </span>
                                    <span className="cashier-nav-label text-xs">{sub.label}</span>
                                  </SidebarMenuButton>
                                </SidebarMenuItem>
                              );
                            })}
                          </div>
                        )}
                      </React.Fragment>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        {/* Sidebar Footer */}
        <SidebarFooter className={"cashier-sidebar__footer p-3 flex flex-col gap-2"}>
            <CashierSidebarFooter
              hasOnlineMenu={hasOnlineMenu}
              handleSidebarNavigation={handleSidebarNavigation}
              changeFontSize={changeFontSize} fontSize={fontSize}
              setTheme={setTheme} theme={theme} activeWaiterNome={activeWaiterNome}
            />
          </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </>
  );
}
