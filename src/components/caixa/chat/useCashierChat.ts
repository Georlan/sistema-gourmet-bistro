/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL } from '../../../config/api';
import './cashierChatAttention.css';
import { consumeCashierChatEvents } from './cashierChatRealtime';

export type CashierChatHealth = 'idle' | 'loading' | 'healthy' | 'degraded';

function reportUnreadFailure(error: unknown) {
  console.warn('Falha ao atualizar não lidas do chat do Caixa:', error);
  void import('@sentry/react')
    .then((Sentry) => Sentry.captureException(error, {
      tags: { feature: 'cashier_chat', operation: 'unread_count' },
    }))
    .catch(() => {});
}

export function useCashierChat(apiBaseUrl: string, authorization: string) {
  const requestGeneration = useRef(0);
  const chatAudioCtxRef = useRef<AudioContext | null>(null);
  const chatAudioUnlockedRef = useRef(false);
  const soundedMessageIdsRef = useRef<Set<string>>(new Set());
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  const [chatUnreadStatus, setChatUnreadStatus] = useState<CashierChatHealth>('idle');

  const playChatMessageAlert = useCallback(() => {
    if (localStorage.getItem('@koma:sound_enabled') === 'false' || !chatAudioUnlockedRef.current) return;

    try {
      if (!chatAudioCtxRef.current || chatAudioCtxRef.current.state === 'closed') {
        chatAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = chatAudioCtxRef.current;
      if (ctx.state !== 'running') return;

      const t = ctx.currentTime;
      // Assinatura exclusiva de mensagem: dois toques curtos e suaves, claramente
      // diferentes do bipe único de pedido e do padrão 3-notas do delivery.
      const notes = [
        { freq: 587.33, start: 0, dur: 0.08, vol: 0.18 },
        { freq: 739.99, start: 0.095, dur: 0.13, vol: 0.24 },
      ];

      notes.forEach(({ freq, start, dur, vol }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + start);
        gain.gain.setValueAtTime(0.001, t + start);
        gain.gain.exponentialRampToValueAtTime(vol, t + start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, t + start + dur);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t + start);
        osc.stop(t + start + dur + 0.03);
      });
    } catch {
      // Web Audio indisponível: o badge visual continua sendo a fonte de atenção.
    }
  }, []);

  const maybePlayChatMessageAlert = useCallback((data: Record<string, unknown> | null) => {
    if (data?.sender_type !== 'customer') return;
    const messageId = typeof data?.id === 'string' ? data.id : null;
    if (!messageId || soundedMessageIdsRef.current.has(messageId)) return;

    soundedMessageIdsRef.current.add(messageId);
    if (soundedMessageIdsRef.current.size > 200) {
      const oldest = soundedMessageIdsRef.current.values().next().value;
      if (oldest) soundedMessageIdsRef.current.delete(oldest);
    }
    playChatMessageAlert();
  }, [playChatMessageAlert]);

  const fetchUnread = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!authorization) {
      setChatUnreadCount(0);
      setChatUnreadStatus('idle');
      return;
    }

    setChatUnreadStatus((current) => current === 'healthy' ? current : 'loading');
    const base = apiBaseUrl || API_BASE_URL;
    try {
      const response = await fetch(`${base}/api/caixa/conversas/unread-count`, {
        headers: { Authorization: authorization },
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Unread count unavailable (${response.status}).`);
      }
      const data = await response.json();
      if (generation !== requestGeneration.current) return;
      const total = Number(data?.total_unread);
      if (!Number.isFinite(total) || total < 0) {
        throw new Error('Unread count returned an invalid payload.');
      }
      setChatUnreadCount(Math.floor(total));
      setChatUnreadStatus('healthy');
    } catch (error) {
      if (generation !== requestGeneration.current) return;
      // UNKNOWN nunca vira ZERO: preserva o último snapshot válido.
      setChatUnreadStatus('degraded');
      reportUnreadFailure(error);
    }
  }, [apiBaseUrl, authorization]);

  useEffect(() => {
    const unlockChatAudio = () => {
      try {
        if (!chatAudioCtxRef.current || chatAudioCtxRef.current.state === 'closed') {
          chatAudioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        const ctx = chatAudioCtxRef.current;
        if (ctx.state === 'running') {
          chatAudioUnlockedRef.current = true;
          return;
        }
        void ctx.resume()
          .then(() => {
            chatAudioUnlockedRef.current = ctx.state === 'running';
          })
          .catch(() => {
            chatAudioUnlockedRef.current = false;
          });
      } catch {
        chatAudioUnlockedRef.current = false;
      }
    };

    window.addEventListener('pointerdown', unlockChatAudio, { passive: true });
    window.addEventListener('keydown', unlockChatAudio, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockChatAudio);
      window.removeEventListener('keydown', unlockChatAudio);
    };
  }, []);

  useEffect(() => {
    if (!authorization) {
      setChatUnreadCount(0);
      setChatUnreadStatus('idle');
      return;
    }

    void fetchUnread();
    const controller = new AbortController();
    const base = apiBaseUrl || API_BASE_URL;
    let fallbackInterval: number | null = null;
    let reconnectTimer: number | null = null;
    let stopped = false;

    const stopFallback = () => {
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const startFallback = () => {
      if (fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(() => {
        if (!document.hidden) void fetchUnread();
      }, 30000);
    };

    const connect = () => {
      if (stopped || controller.signal.aborted) return;
      void consumeCashierChatEvents({
        url: `${base}/api/caixa/conversas/events`,
        authorization,
        signal: controller.signal,
        onOpen: () => {
          stopFallback();
          void fetchUnread();
        },
        onEvent: ({ event, data }) => {
          if (event === 'new_message') {
            maybePlayChatMessageAlert(data);
          }
          if (event === 'new_message' || event === 'status_changed' || event === 'read_update') {
            void fetchUnread();
          }
        },
      }).catch((error) => {
        if (stopped || controller.signal.aborted) return;
        setChatUnreadStatus('degraded');
        reportUnreadFailure(error);
        startFallback();
        reconnectTimer = window.setTimeout(connect, 5000);
      });
    };

    connect();
    const handleVisibility = () => {
      if (!document.hidden) void fetchUnread();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopped = true;
      requestGeneration.current += 1;
      controller.abort();
      stopFallback();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [apiBaseUrl, authorization, fetchUnread, maybePlayChatMessageAlert]);

  useEffect(() => {
    const cleanTitle = document.title.replace(/^\(\d+\)\s*/, '');
    document.title = chatUnreadCount > 0
      ? `(${chatUnreadCount}) ${cleanTitle}`
      : cleanTitle;
    return () => {
      document.title = cleanTitle;
    };
  }, [chatUnreadCount]);

  return {
    isChatDrawerOpen,
    setIsChatDrawerOpen,
    chatUnreadCount,
    chatUnreadStatus,
    setChatUnreadCount,
    refreshChatUnreadCount: fetchUnread,
  };
}
