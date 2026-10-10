import { useEffect, useRef } from 'react';
import { orderUpdateAffects } from '../../../utils/orderUpdate';
import { createIdleReconciliation } from './idleReconciliation';

/** Histories/diagnostics only; never owns financial mutations or print claiming. */
export function useIdleReconciliation({ enabled = true, isWsConnected, eventName, refresh, healthyIntervalMs }: {
  enabled?: boolean;
  isWsConnected: boolean;
  eventName: string;
  healthyIntervalMs?: number;
  refresh: () => Promise<unknown>;
}) {
  const controllerRef = useRef<ReturnType<typeof createIdleReconciliation> | null>(null);
  const connectedRef = useRef(isWsConnected);
  connectedRef.current = isWsConnected;
  useEffect(() => {
    if (!enabled) return;
    const controller = createIdleReconciliation({
      refresh,
      healthyIntervalMs,
      connected: connectedRef.current,
      visible: () => !document.hidden,
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: id => window.clearTimeout(id),
    });
    controllerRef.current = controller;
    const resume = () => { if (!document.hidden) controller.resume(); };
    const onUpdate = (event: Event) => {
      if (eventName !== 'koma_orders_updated' || orderUpdateAffects(event, 'digital')) controller.invalidate();
    };
    window.addEventListener(eventName, onUpdate);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      controller.dispose();
      controllerRef.current = null;
      window.removeEventListener(eventName, onUpdate);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [enabled, eventName, refresh, healthyIntervalMs]);
  useEffect(() => { controllerRef.current?.setConnected(isWsConnected); }, [isWsConnected]);
}
