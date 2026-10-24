import React, { useEffect, useState } from 'react';
import { KOMA_OPEN_WAITER_HISTORY_EVENT } from './waiterHistoryEvents';
const WaiterHistoryPanel = React.lazy(() => import('./WaiterHistoryPanel'));

export function WaiterHistoryHost({ getAuthHeaders }: { getAuthHeaders: () => Record<string, string> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(KOMA_OPEN_WAITER_HISTORY_EVENT, show);
    return () => window.removeEventListener(KOMA_OPEN_WAITER_HISTORY_EVENT, show);
  }, []);
  if (!open) return null;
  return <React.Suspense fallback={<div role="status" className="fixed inset-0 z-50 bg-koma-page p-6">Abrindo histórico…</div>}>
    <WaiterHistoryPanel getAuthHeaders={getAuthHeaders} onClose={() => setOpen(false)} />
  </React.Suspense>;
}
