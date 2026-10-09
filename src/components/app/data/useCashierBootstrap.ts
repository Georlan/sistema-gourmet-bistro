import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';
import { snapshotFetch } from '../../../utils/snapshotFetch';
import { orderUpdateAffects } from '../../../utils/orderUpdate';
export type DigitalBootstrap = { active: unknown[]; pending: unknown[] };

/** Read dedicated digital projections alongside salon bootstrap, then hand
 * ownership to the mounted cashier. Retain hints received before that handoff. */
export function useCashierBootstrap(scope: string, enabled: boolean, getHeaders: () => Record<string, string>) {
  const [snapshot, setSnapshot] = useState<{ scope: string; data?: DigitalBootstrap } | null>(null);
  const handoffReady = useRef(false);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const consume = useCallback(() => {
    if (scopeRef.current === scope) handoffReady.current = true;
  }, [scope]);
  const headersRef = useRef(getHeaders);
  headersRef.current = getHeaders;
  useEffect(() => {
    if (!enabled || !scope) return;
    handoffReady.current = false;
    const controller = new AbortController();
    let reading = false;
    let dirty = false;
    const read = async () => {
      if (reading) { dirty = true; return; }
      reading = true;
      setSnapshot(null);
      try {
        do {
          dirty = false;
          let data: DigitalBootstrap | undefined;
          try {
            const headers = headersRef.current();
            const responses = await Promise.all(['ativos', 'pendentes'].map(path => snapshotFetch(`${API_BASE_URL}/comandas/delivery/${path}`, { headers, signal: controller.signal })));
            if (responses.some(response => !response.ok)) throw new Error('DIGITAL_BOOTSTRAP_HTTP');
            const [active, pending] = await Promise.all(responses.map(response => response.json()));
            if (!Array.isArray(active) || !Array.isArray(pending)) throw new Error('DIGITAL_BOOTSTRAP_PAYLOAD');
            data = { active, pending };
          } catch {
            // The mounted digital owner provides its error state and recovery.
          }
          if (!dirty && !controller.signal.aborted) setSnapshot({ scope, data });
        } while (dirty && !controller.signal.aborted);
      } finally { reading = false; }
    };
    const onUpdate = (event: Event) => {
      if (!handoffReady.current && orderUpdateAffects(event, 'digital')) void read();
    };
    window.addEventListener('koma_orders_updated', onUpdate);
    void read();
    return () => {
      handoffReady.current = false;
      controller.abort();
      window.removeEventListener('koma_orders_updated', onUpdate);
    };
  }, [scope, enabled]);
  return { consume, ready: !enabled || snapshot?.scope === scope, data: snapshot?.scope === scope ? snapshot.data : undefined };
}
