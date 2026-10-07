import { useCallback, useEffect, useRef, useState } from 'react';
import { isCashierTableOrder } from '../../../domain/cashierOrderProjection';
import { deriveFinancialState } from '../../../domain/operationalState';
import type { Order } from '../../../types';
import type { DeliveryOrderView } from '../orders/cashierWorkspaceTypes';

type Props = {
  orders: Order[];
  deliveryOrders: DeliveryOrderView[];
  pendingAcceptanceOrders: DeliveryOrderView[];
  isDrawerOpen: boolean;
};

/** Owns alerts state, effects and actions; composition supplies only cross-feature dependencies. */
export function useCashierAlerts({ orders, deliveryOrders, pendingAcceptanceOrders }: Props) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const lastDigitalAlertAtRef = useRef<number | null>(null);
  const [audioReady, setAudioReady] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('@koma:sound_enabled') !== 'false';
  });

  const playOrderAlert = useCallback(
    (type: 'new_order' | 'bill_requested' | 'delivery_pending' | 'test' = 'new_order') => {
      if (type !== 'test' && (!soundEnabled || !audioUnlockedRef.current)) return;
      if (type === 'delivery_pending') {
        const now = performance.now();
        if (lastDigitalAlertAtRef.current !== null && now - lastDigitalAlertAtRef.current < 250) return;
        lastDigitalAlertAtRef.current = now;
      }
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          if (type !== 'test') return;
          void ctx.resume().then(() => {
            audioUnlockedRef.current = ctx.state === 'running';
            setAudioReady(audioUnlockedRef.current);
          }).catch(() => {
            audioUnlockedRef.current = false;
            setAudioReady(false);
          });
        } else if (ctx.state === 'running') {
          audioUnlockedRef.current = true;
          setAudioReady(true);
        }
        const t = ctx.currentTime;

        if (type === 'new_order') {
          // Um único bipe curto confirma um novo pedido.
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

  const activateAudio = useCallback(async () => {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const ready = ctx.state === 'running';
      audioUnlockedRef.current = ready;
      setAudioReady(ready);
      if (!ready) return false;

      setSoundEnabled(true);
      localStorage.setItem('@koma:sound_enabled', 'true');
      playOrderAlert('test');
      return true;
    } catch {
      audioUnlockedRef.current = false;
      setAudioReady(false);
      return false;
    }
  }, [playOrderAlert]);

  const toggleSound = () => {
    if (soundEnabled) {
      setSoundEnabled(false);
      localStorage.setItem('@koma:sound_enabled', 'false');
      return;
    }
    void activateAudio();
  };

  useEffect(() => {
    let disposed = false;
    const unlock = () => {
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'running') {
          audioUnlockedRef.current = true;
          setAudioReady(true);
          return;
        }
        void ctx.resume().then(() => {
          if (disposed) return;
          audioUnlockedRef.current = ctx.state === 'running';
          setAudioReady(audioUnlockedRef.current);
        }).catch(() => {
          if (disposed) return;
          audioUnlockedRef.current = false;
          setAudioReady(false);
        });
      } catch {
        audioUnlockedRef.current = false;
        setAudioReady(false);
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
    return () => {
      disposed = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audioUnlockedRef.current = false;
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
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

  // Guarda os timers de alerta ativos por id de pedido para cancelamento antecipado e cleanup.
  const pendingAlertTimersRef = useRef<Map<string, number[]>>(new Map());

  // Limpa todos os timers no unmount para evitar memory leaks.
  useEffect(() => {
    return () => {
      pendingAlertTimersRef.current.forEach((timers) => {
        timers.forEach((timerId) => window.clearTimeout(timerId));
      });
      pendingAlertTimersRef.current.clear();
    };
  }, []);

  // Monitora cancelamento antecipado: se um pedido sair de pendingAcceptanceOrders
  // (foi aceito, recusado ou cancelado), cancela imediatamente os alertas restantes dele.
  useEffect(() => {
    const activePendingIds = new Set(pendingAcceptanceOrders.map((o) => String(o.id)));
    pendingAlertTimersRef.current.forEach((timers, orderId) => {
      if (!activePendingIds.has(orderId)) {
        timers.forEach((timerId) => window.clearTimeout(timerId));
        pendingAlertTimersRef.current.delete(orderId);
      }
    });
  }, [pendingAcceptanceOrders]);

  // Ciclo de alerta para novos pedidos digitais pendentes:
  // Máximo de 3 toques por pedido (t=0s, t~4s, t~8s).
  // Deduplicado estritamente por id: refetch, polling e rerender nunca tocam novamente.
  useEffect(() => {
    const currentIds = new Set(deliveryOrders.map((order) => String(order.id)));
    if (knownDigitalOrderIdsRef.current === null) {
      // Linha de base inicial: memoriza IDs já existentes e não dispara alertas retrospectivos.
      knownDigitalOrderIdsRef.current = currentIds;
      return;
    }

    const known = knownDigitalOrderIdsRef.current;
    if (!Array.from(currentIds).some((id) => !known.has(id))) return;

    const pendingIdsSet = new Set(pendingAcceptanceOrders.map((o) => String(o.id)));

    // Identifica novos pedidos que acabaram de surgir
    const newlyArrivedOrders = deliveryOrders.filter((order) => {
      const id = String(order.id);
      return !known.has(id);
    });

    // Registra todos os novos IDs no conjunto de conhecidos imediatamente
    newlyArrivedOrders.forEach((order) => known.add(String(order.id)));

    // Dispara ciclo de até 3 alertas apenas para novos pedidos que estejam aguardando aceite
    newlyArrivedOrders.forEach((order) => {
      const orderId = String(order.id);
      const isPending =
        pendingIdsSet.has(orderId) ||
        order.status === 'pendente' ||
        order.status === 'analise';
      if (!isPending) return;

      // 1º Alerta (t = 0s)
      playOrderAlert('delivery_pending');

      const timers: number[] = [];

      // 2º Alerta (t ≈ 4s)
      const t1 = window.setTimeout(() => {
        if (pendingAlertTimersRef.current.has(orderId)) {
          playOrderAlert('delivery_pending');
        }
      }, 4000);
      timers.push(t1);

      // 3º Alerta (t ≈ 8s)
      const t2 = window.setTimeout(() => {
        if (pendingAlertTimersRef.current.has(orderId)) {
          playOrderAlert('delivery_pending');
          pendingAlertTimersRef.current.delete(orderId);
        }
      }, 8000);
      timers.push(t2);

      pendingAlertTimersRef.current.set(orderId, timers);
    });
  }, [deliveryOrders, pendingAcceptanceOrders, playOrderAlert]);

  return { soundEnabled, audioReady, activateAudio, toggleSound, playOrderAlert };
}
