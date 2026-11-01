import { useCallback, useEffect, useRef, useState } from 'react';
import type { CashierNotice } from '../cashierContracts';

/** Owns the lifetime of the current transient notice. */
export function useCashierNotice() {
  const [toastData, setToastData] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const showToast: CashierNotice = useCallback((msg, type = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToastData({ msg, type });
    timer.current = setTimeout(() => { setToastData(null); timer.current = null; }, 3000);
  }, []);
  return { toastData, showToast };
}
