import clsx from 'clsx';
import { Lock } from 'lucide-react';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../../ui/sidebar';
import type { CashierSidebarProps } from './cashierNavigationContracts';
import { CASHIER_SIDEBAR_GROUPS } from './cashierNavigation';

type Props = Pick<
  CashierSidebarProps,
  'hasOnlineMenu' | 'isSidebarTabActive' | 'sidebarOrderCount' | 'handleSidebarNavigation'
> & {
  closeMobile?: boolean;
};

/**
 * Shared Navigation Tree v2 renderer.
 *
 * Responsive shells own overlay/collapse behavior; information architecture,
 * active-state rules and navigation commands stay identical on desktop/mobile.
 */
export function CashierSidebarNavigation({
  hasOnlineMenu,
  isSidebarTabActive,
  sidebarOrderCount,
  handleSidebarNavigation,
  closeMobile = false,
}: Props) {
  return (
    <>
      {CASHIER_SIDEBAR_GROUPS.map((group) => (
        <SidebarGroup key={group.category}>
          <SidebarGroupLabel className="cashier-nav-group-label">{group.category}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isLocked = item.capability === 'online-menu' && !hasOnlineMenu;
                const isActive = isSidebarTabActive(item.id);
                const hasChildren = Boolean(item.children?.length);

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => handleSidebarNavigation(item.id, closeMobile)}
                      className="cashier-nav-item"
                      title={item.label}
                    >
                      <span className="cashier-nav-icon">
                        <Icon size={15} />
                      </span>
                      <span className="cashier-nav-label">{item.label}</span>
                      {item.id === 'operacao' && sidebarOrderCount > 0 && (
                        <SidebarMenuBadge>{sidebarOrderCount}</SidebarMenuBadge>
                      )}
                      {isLocked && (
                        <span className="cashier-nav-plan">
                          <Lock size={9} />
                          <span>Plano</span>
                        </span>
                      )}
                    </SidebarMenuButton>

                    {hasChildren && isActive && (
                      <div
                        className="cashier-nav-children ml-6 mt-1 space-y-0.5 border-l border-koma-border pl-2 group-data-[collapsible=icon]:hidden"
                        aria-label={`Atalhos de ${item.label}`}
                      >
                        {item.children?.map((child) => {
                          const childActive = isSidebarTabActive(child.id);
                          const childCount = child.badge === 'orders' ? sidebarOrderCount : 0;

                          return (
                            <button
                              key={child.id}
                              type="button"
                              onClick={() => handleSidebarNavigation(child.id, closeMobile)}
                              className={clsx(
                                'cashier-nav-child flex min-h-7 w-full items-center gap-2 rounded-lg px-2 text-left text-[11px] font-semibold transition-colors',
                                childActive
                                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'text-koma-subtle hover:bg-koma-raised hover:text-koma-foreground',
                              )}
                              aria-current={childActive ? 'page' : undefined}
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-60" />
                              <span className="min-w-0 flex-1 truncate">{child.label}</span>
                              {childCount > 0 && (
                                <span className="rounded-full bg-koma-raised px-1.5 py-0.5 font-mono text-[8px] text-koma-muted">
                                  {childCount}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
