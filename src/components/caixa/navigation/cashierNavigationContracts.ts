import type { Dispatch, SetStateAction } from 'react';
import type { CaixaPanelProps } from '../cashierContracts';
import type { SubscriptionEntitlements, SubscriptionPlanId } from '../../../config/subscriptionPlans';
import type { useCashShift } from '../shift/useCashShift';
import type { useCashierNavigation } from './useCashierNavigation';
import type { useCashierPreferences } from './useCashierPreferences';

/** Shared contract; desktop and mobile keep their own presentation. */
export type CashierSidebarProps = Pick<ReturnType<typeof useCashShift>, 'turno' | 'turnoLoadState' | 'setShowAbrirModal'> &
  Pick<ReturnType<typeof useCashierNavigation>, 'isSidebarTabActive' | 'handleSidebarNavigation'> &
  Pick<ReturnType<typeof useCashierPreferences>, 'changeFontSize' | 'fontSize' | 'setTheme' | 'theme'> &
  Pick<CaixaPanelProps, 'activeWaiterNome'> & {
    setIsOperatorDrawerOpen: Dispatch<SetStateAction<boolean>>;
    planId: SubscriptionPlanId;
    entitlements?: SubscriptionEntitlements;
    hasOnlineMenu: boolean;
    sidebarOrderCount: number;
  };