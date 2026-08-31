import type { Dispatch, SetStateAction } from 'react';
import type { CaixaPanelProps } from '../cashierContracts';
import type { useCashShift } from '../shift/useCashShift';
import type { useCashierNavigation } from './useCashierNavigation';
import type { useCashierPreferences } from './useCashierPreferences';

/** Shared contract; desktop and mobile keep their own presentation. */
export type CashierSidebarProps = Pick<ReturnType<typeof useCashShift>, 'turno' | 'setShowAbrirModal'> &
  Pick<ReturnType<typeof useCashierNavigation>, 'isSidebarTabActive' | 'handleSidebarNavigation'> &
  Pick<ReturnType<typeof useCashierPreferences>, 'changeFontSize' | 'fontSize' | 'setTheme' | 'theme'> &
  Pick<CaixaPanelProps, 'activeWaiterNome'> & {
    setIsOperatorDrawerOpen: Dispatch<SetStateAction<boolean>>;
    hasOnlineMenu: boolean;
    sidebarOrderCount: number;
  };
