import { useCallback, useEffect, useRef, useState } from 'react';
import { projectCashierDeliveryState } from '../../../domain/cashierOrderProjection';
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
    if (next) {
      playOrderAlert('test');
    }
  };

  // Motor de Síntese Sonora Web Audio API — Independente, sem arquivo de áudio externo
  const playOrderAlert = useCallback(
    (type: 'new_order' | 'bill_requested' | 'delivery_pending' | 'test' = 'new_order') => {
      if (type !== 'test' && (!soundEnabled || !audioUnlockedRef.current)) return;
      try {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
          audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          // Fora de uma interação do usuário o navegador bloqueia resume().
          // O desbloqueio é feito pelo listener abaixo; não poluímos o console
          // nem criamos alertas parciais enquanto o áudio ainda está suspenso.
          if (type !== 'test') return;
          void ctx
            .resume()
            .then(() => {
              audioUnlockedRef.current = true;
            })
            .catch(() => undefined);
        } else if (ctx.state === 'running') {
          audioUnlockedRef.current = true;
        }
        const t = ctx.currentTime;

        if (type === 'new_order') {
          // Um único bipe curto confirma um novo pedido. Outros eventos mantêm
          // assinaturas sonoras próprias, evitando a sensação de evento duplicado.
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
          // Alerta de mesa pedindo conta / pré-conta (Ding-Dong: C6 -> G5)
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
          // Alerta de pedido online / WhatsApp / Retirada: 880 -> 1174 -> 880
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
          // Teste de som: 3 notas ascendentes (C5 -> E5 -> G5)
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
      } catch (e) {
        /* audio context unavailable */
      }
    },
    [soundEnabled]
  );

  // Desbloqueia o contexto de áudio somente dentro de uma interação real.
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
        void ctx
          .resume()
          .then(() => {
            audioUnlockedRef.current = ctx.state === 'running';
          })
          .catch(() => {
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

  // Monitor universal de pedidos e mesas (Garçom / Caixa / Salão)
  const isInitialOrdersMountRef = useRef(true);

  const prevOrdersSignatureRef = useRef({
    itemsCount: 0,
    billRequestedCount: 0,
  });

  useEffect(() => {
    const active = orders.filter(
      (o) => !String(o.id || '').startsWith('temp-') && o.status !== 'fechada' && o.status !== 'cancelado'
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
      // Uma comanda vazia é apenas sessão de mesa, não um pedido novo.
      // O som nasce somente quando os itens que também geram o card chegam.
      playOrderAlert('new_order');
    }

    prevOrdersSignatureRef.current = { itemsCount, billRequestedCount };
  }, [orders, playOrderAlert]);

  // Monitor de pedidos delivery / online pendentes
  const prevDeliveryPendingCountRef = useRef<number | null>(null);

  useEffect(() => {
    const pendingCount = deliveryOrders.filter((o) => projectCashierDeliveryState(o.status).awaitingAcceptance).length;
    if (prevDeliveryPendingCountRef.current === null) {
      prevDeliveryPendingCountRef.current = pendingCount;
      return;
    }
    if (pendingCount > prevDeliveryPendingCountRef.current && !isDrawerOpen) {
      playOrderAlert('delivery_pending');
    }
    prevDeliveryPendingCountRef.current = pendingCount;
  }, [deliveryOrders, isDrawerOpen, playOrderAlert]);

  return { soundEnabled, toggleSound, playOrderAlert };
}
