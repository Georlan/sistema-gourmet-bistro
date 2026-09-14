import { useCallback, useEffect, useRef, useState } from 'react';
import { isCashierTableOrder } from '../../../domain/cashierOrderProjection';
import { deriveFinancialState } from '../../../domain/operationalState';
import type { Order } from '../../../types';
import type { DeliveryOrderView } from '../orders/cashierWorkspaceTypes';

type Props = {
  orders: Order[];
  deliveryOrders: DeliveryOrderView[];
  isDrawerOpen: boolean;
};

/** Owns alerts state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashierAlerts({ orders, deliveryOrders, isDrawerOpen }: Props) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('@koma:sound_enabled') !== 'false';
  });

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('@koma:sound_enabled', String(next));
    if (next) playOrderAlert('test');
  };

  const playOrderAlert = useCallback(
    (type: 'new_order' | 'bill_requested' | 'delivery_pending' | 'test' = 'new_order') => {
      if (type !== 'test' && (!soundEnabled || !audioUnlockedRef.current)) return;
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          if (type !== 'test') return;
          void ctx.resume().then(() => {
            audioUnlockedRef.current = true;
          }).catch(() => undefined);
        } else if (ctx.state === 'running') {
          audioUnlockedRef.current = true;
        }
        const t = ctx.currentTime;

        if (type === 'new_order') {
          const notes = [{ freq: 783.99, start: 0, dur: 0.18, vol: 0.34 }];
          notes.forEach(({ freq, start, dur, vol }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, t + start);
            gain.gain.setValueAtTime(0.001, t + start);
            gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t + start);
            osc.stop(t + start + dur + 0.05);
          });
        } else if (type === 'bill_requested') {
          const notes = [
            { freq: 1046.5, start: 0, dur: 0.14, vol: 0.35 },
            { freq: 783.99, start: 0.14, dur: 0.28, vol: 0.4 },
          ];
          notes.forEach(({ freq, start, dur, vol }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + start);
            gain.gain.setValueAtTime(0.001, t + start);
            gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t + start);
            osc.stop(t + start + dur + 0.05);
          });
        } else if (type === 'delivery_pending') {
          const notes = [
            { freq: 880.0, start: 0, dur: 0.1, vol: 0.3 },
            { freq: 1174.66, start: 0.12, dur: 0.14, vol: 0.38 },
            { freq: 880.0, start: 0.28, dur: 0.18, vol: 0.3 },
          ];
          notes.forEach(({ freq, start, dur, vol }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + start);
            gain.gain.setValueAtTime(0.001, t + start);
            gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t + start);
            osc.stop(t + start + dur + 0.05);
          });
        } else if (type === 'test') {
          const notes = [
            { freq: 523.25, start: 0, dur: 0.1, vol: 0.25 },
            { freq: 659.25, start: 0.1, dur: 0.1, vol: 0.3 },
            { freq: 783.99, start: 0.2, dur: 0.22, vol: 0.35 },
          ];
          notes.forEach(({ freq, start, dur, vol }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, t + start);
            gain.gain.setValueAtTime(0.001, t + start);
            gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(t + start);
            osc.stop(t + start + dur + 0.05);
          });
        }
      } catch {
        /* audio context unavailable */
      }
    },
    [soundEnabled]
  );

  useEffect(() => {
    const unlock = () => {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'running') {
          audioUnlockedRef.current = true;
          return;
        }
        void ctx.resume().then(() => {
          audioUnlockedRef.current = ctx.state === 'running';
        }).catch(() => {
          audioUnlockedRef.current = false;
        });
      } catch {
        audioUnlockedRef.current = false;
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Pedidos presenciais e digitais têm donos de alerta separados. Assim um
  // pedido online nunca toca como pedido de mesa e depois toca de novo como digital.
  const isInitialOrdersMountRef = useRef(true);
  const prevOrdersSignatureRef = useRef({ itemsCount: 0, billRequestedCount: 0 });

  useEffect(() => {
    const active = orders.filter(
      (o) =>
        !String(o.id || '').startsWith('temp-') &&
        o.status !== 'fechada' &&
        o.status !== 'cancelado' &&
        isCashierTableOrder(o)
    );
    const itemsCount = active.reduce((sum, o) => sum + (o.itens ? o.itens.length : 0), 0);
    const billRequestedCount = active.filter(
      (o) =>
        deriveFinancialState([o, { statusComanda: (o as any).status_comanda }], {
          hasPendingPayment: (o as any).contaPedida === true,
        }) === 'AWAITING_PAYMENT'
    ).length;

    if (isInitialOrdersMountRef.current) {
      isInitialOrdersMountRef.current = false;
      prevOrdersSignatureRef.current = { itemsCount, billRequestedCount };
      return;
    }

    const prev = prevOrdersSignatureRef.current;
    if (billRequestedCount > prev.billRequestedCount) {
      playOrderAlert('bill_requested');
    } else if (itemsCount > prev.itemsCount) {
      playOrderAlert('new_order');
    }

    prevOrdersSignatureRef.current = { itemsCount, billRequestedCount };
  }, [orders, playOrderAlert]);

  // Identidade, não contagem, define se o pedido digital é novo. A primeira
  // fotografia apenas estabelece a linha de base; mudanças de status, refresh,
  // WebSocket e reconciliações do mesmo id não geram outro som.
  const knownDigitalOrderIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = new Set(deliveryOrders.map((order) => String(order.id)));
    if (knownDigitalOrderIdsRef.current === null) {
      knownDigitalOrderIdsRef.current = currentIds;
      return;
    }

    const known = knownDigitalOrderIdsRef.current;
    const hasNewOrder = Array.from(currentIds).some((id) => !known.has(id));
    currentIds.forEach((id) => known.add(id));

    if (hasNewOrder && !isDrawerOpen) {
      playOrderAlert('delivery_pending');
    }
  }, [deliveryOrders, isDrawerOpen, playOrderAlert]);

  return { soundEnabled, toggleSound, playOrderAlert };
}
